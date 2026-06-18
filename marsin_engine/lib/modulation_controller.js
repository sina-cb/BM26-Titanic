// ModulationController — Phase 1B integration layer.
//
// Sits between the playlist's modulation definitions and the WASM VM.
// Each frame: reads sources from ParamCenter, evaluates the active
// mappings via modulation_engine.applyModulations, writes modulated
// values to mixer.wasmHost.setControl(), and (throttled) broadcasts a
// modulationState frame on /ws/params for the iPad ghost slider.
//
// Mapping state is push-driven by api_server (deck swap onComplete +
// REST CRUD). The hot loop NEVER touches disk.

import {
  resolveModulationSources,
  applyModulations,
} from './modulation_engine.js';

export class ModulationController {
  /**
   * @param {{
   *   mixer: any,
   *   paramCenter: any,
   *   broadcast: (msg: object) => void,
   *   broadcastHz?: number,
   * }} deps
   */
  constructor({ mixer, paramCenter, broadcast, broadcastHz = 20 }) {
    this.mixer = mixer;
    this.paramCenter = paramCenter;
    this.broadcast = broadcast;
    this.broadcastIntervalMs = Math.max(1, Math.round(1000 / broadcastHz));

    // Active entry context. Pushed by api_server on deck swap / CRUD.
    /** @type {string|null} */ this.activePlaylistName = null;
    /** @type {string|null} */ this.activeEntryId = null;
    /** @type {string|null} */ this.activePattern = null;
    /** @type {import('./modulation_engine.js').ModulationMapping[]} */
    this.activeMappings = [];

    // Bookkeeping for "restore base when a mapping is removed" semantics.
    /** @type {Set<string>} */
    this._lastWrittenTargets = new Set();
    // Negative sentinel so the first applyFrame() call after boot
    // always passes the throttle gate.
    this._lastBroadcastMs = -this.broadcastIntervalMs;
    // Tracks whether the last broadcast frame carried any parameters.
    // We use this to fire ONE final "empty" frame the moment a deletion
    // takes the parameter count to zero — otherwise the iPad's ghost
    // overlay never clears (the throttled steady-state branch below
    // skips emit when `parameters` is empty). Operator-visible symptom:
    // tap ✕ on a mapping → green dot lingers on the slider forever.
    this._lastBroadcastHadParams = false;
  }

  /**
   * Called by api_server whenever the deck switches entries or the
   * REST CRUD endpoints mutate mappings on the currently-active entry.
   * Passing an empty array clears modulation for the active entry.
   *
   * @param {{
   *   playlistName: string|null,
   *   entryId: string|null,
   *   pattern: string|null,
   *   mappings: import('./modulation_engine.js').ModulationMapping[],
   * }} ctx
   */
  setActiveEntry({ playlistName, entryId, pattern, mappings }) {
    this.activePlaylistName = playlistName ?? null;
    this.activeEntryId = entryId ?? null;
    this.activePattern = pattern ?? null;
    this.activeMappings = Array.isArray(mappings) ? mappings : [];
  }

  /**
   * Called from the render loop, once per tick, AFTER paramCenter
   * flushDirty and BEFORE mixer.beginFrame.
   *
   * @param {number} nowMs
   */
  applyFrame(nowMs) {
    const deckCh = this.mixer.getDeckChannel?.();
    if (!deckCh || !deckCh.handle) {
      this._restoreBaselinesAndClear(null);
      return;
    }

    // Perf early-out: when there are ZERO active mappings AND nothing was
    // written last frame (so no baseline-restore is owed) AND the last
    // broadcast was already empty (ghost overlay already cleared), there is
    // no work to do — skip the per-frame getExports()/JSON.parse(getAll())
    // entirely. The moment a mapping is added this branch stops short-
    // circuiting; the moment the last mapping is removed we still run one
    // more full frame (mappings just went to 0 but _lastWrittenTargets /
    // _lastBroadcastHadParams are still set) to restore baselines and fire
    // the single clearing broadcast, then settle into this no-op path.
    if (this.activeMappings.length === 0
        && this._lastWrittenTargets.size === 0
        && !this._lastBroadcastHadParams) {
      return;
    }

    const wasmHost = this.mixer.wasmHost;
    const exports = wasmHost.getExports(deckCh.handle) || [];
    const exportByName = new Map();
    for (const exp of exports) exportByName.set(exp.name, exp);

    const baseParams = {};
    for (const exp of exports) {
      if (exp.kind !== 1) continue; // EXPORT_SLIDER only for v1
      const cv = deckCh.localControls && deckCh.localControls[exp.id];
      baseParams[exp.name] = cv ? cv.v0 : (exp.v0 ?? 0);
    }

    const snapshot = this.paramCenter ? this.paramCenter.getAll() : {};
    const sourceValues = resolveModulationSources({ paramCenterSnapshot: snapshot });

    const result = applyModulations({
      baseParams,
      targetDefs: exports.filter(e => e.kind === 1),
      modulations: this.activeMappings,
      sourceValues,
    });

    // Write modulated values for any target that had a mapping fire.
    const newlyWritten = new Set();
    for (const [name, v] of Object.entries(result.values)) {
      if (v.mappingId === undefined) continue;
      const exp = exportByName.get(name);
      if (!exp) continue;
      wasmHost.setControl(deckCh.handle, exp.id, v.modulated, 0, 0);
      newlyWritten.add(name);
    }

    // Restore base for params that were modulated last frame but aren't
    // this frame (mapping deleted or disabled). One-shot write per
    // transition — once restored, the user's slider owns the value
    // again via paramRouter.
    for (const name of this._lastWrittenTargets) {
      if (newlyWritten.has(name)) continue;
      const exp = exportByName.get(name);
      if (!exp) continue;
      const base = baseParams[name];
      if (typeof base === 'number') {
        wasmHost.setControl(deckCh.handle, exp.id, base, 0, 0);
      }
    }
    this._lastWrittenTargets = newlyWritten;

    // Build the broadcast payload BEFORE the throttle check so we can
    // detect the >0 → 0 transition and fire a single "clearing" frame
    // even when the throttle would otherwise gate emission.
    const parameters = {};
    for (const [name, v] of Object.entries(result.values)) {
      if (v.mappingId === undefined) continue;
      parameters[name] = {
        base: v.base,
        modulated: v.modulated,
        source: v.source,
        mappingId: v.mappingId,
      };
    }
    const hasParams = Object.keys(parameters).length > 0;

    // Transition gate:
    //   1. has params + steady-state throttle hit       → emit
    //   2. zero params + last frame HAD params          → emit ONCE
    //      (so the iPad's ghost overlay clears
    //       immediately after the operator hits ✕)
    //   3. zero params + last frame was already empty   → skip
    if (!hasParams && !this._lastBroadcastHadParams) return;
    if (hasParams && nowMs - this._lastBroadcastMs < this.broadcastIntervalMs) return;
    this._lastBroadcastMs = nowMs;
    this._lastBroadcastHadParams = hasParams;

    this.broadcast({
      type: 'modulationState',
      deckId: 'main',
      pattern: this.activePattern || deckCh.pattern || null,
      parameters,
    });
  }

  /**
   * Hard reset — used when the deck channel disappears (e.g. test
   * teardown) so we don't keep stale baseline-restore state.
   */
  _restoreBaselinesAndClear(_unused) {
    // If the last frame we broadcast HAD params, emit one final empty
    // `modulationState` so the iPad's green ghost overlay clears immediately
    // when the deck disappears mid-modulation (otherwise it lingers stale
    // until the deck returns). Mirrors the >0 → 0 transition gate in applyFrame.
    if (this._lastBroadcastHadParams) {
      this._lastBroadcastHadParams = false;
      this.broadcast({
        type: 'modulationState',
        deckId: 'main',
        pattern: this.activePattern || null,
        parameters: {},
      });
    }
    if (this._lastWrittenTargets.size === 0) return;
    this._lastWrittenTargets.clear();
  }

  /** Snapshot for /api/playlists/.../modulations GET responses. */
  getActiveSnapshot() {
    return {
      playlistName: this.activePlaylistName,
      entryId: this.activeEntryId,
      pattern: this.activePattern,
      mappings: this.activeMappings.slice(),
    };
  }
}
