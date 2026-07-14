// ── Session param cache ──────────────────────────────────────────────────
// In-memory, per-channel retention of operator-tuned LOCAL control values so a
// pattern's tuning survives A→B→A pattern switches for the whole engine
// SESSION — even when file auto-save is gated off (autoSave OFF or performance
// mode). This cache is NEVER persisted: it lives entirely in the process and
// dies with it (a restart/crash reverts to the last on-disk save, matching the
// performance-mode implicit-restore contract). Only the FILE write is gated by
// auto-save; in-session continuity is unconditional.
//
// Keyed by channelId → patternName → { [controlId]: {v0, v1, v2} }.
//
// Pattern NAME (not playlist entry id) is the inner key on purpose:
//   • a direct `/pattern` set (which carries no entry id) and a playlist entry
//     that reference the same pattern share one session intent, and
//   • two playlist entries pointing at the same pattern behave consistently —
//     the latest session tuning of that pattern follows it everywhere.
//
// The store MERGES per control (latest write per control wins) so accumulated
// tuning across multiple visits to a pattern is preserved, and an untouched
// switch-away never erases a pattern's prior cached intent.
export class SessionParamCache {
  constructor() {
    // channelId -> Map(patternName -> { controlId: {v0,v1,v2} })
    this._byChannel = new Map();
  }

  /**
   * Merge the given touched local-control values into the cache for
   * (channelId, patternName). `controls` is a plain object keyed by control id
   * whose values are {v0, v1, v2}. Empty / null controls is a no-op (never
   * erases prior intent). Missing channelId / patternName is a no-op.
   */
  store(channelId, patternName, controls) {
    if (!channelId || !patternName || !controls) return;
    const ids = Object.keys(controls);
    if (ids.length === 0) return;
    let byPattern = this._byChannel.get(channelId);
    if (!byPattern) {
      byPattern = new Map();
      this._byChannel.set(channelId, byPattern);
    }
    let entry = byPattern.get(patternName);
    if (!entry) {
      entry = {};
      byPattern.set(patternName, entry);
    }
    for (const id of ids) {
      const cv = controls[id];
      if (!cv) continue;
      entry[id] = { v0: cv.v0, v1: cv.v1, v2: cv.v2 };
    }
  }

  /**
   * Return the cached control map for (channelId, patternName), or null if
   * there is no cached tuning. The returned object is the live internal store —
   * callers MUST NOT mutate it.
   */
  get(channelId, patternName) {
    if (!channelId || !patternName) return null;
    const byPattern = this._byChannel.get(channelId);
    if (!byPattern) return null;
    return byPattern.get(patternName) || null;
  }

  /** Drop one (channelId, patternName) entry. */
  clearPattern(channelId, patternName) {
    const byPattern = this._byChannel.get(channelId);
    if (byPattern) byPattern.delete(patternName);
  }

  /**
   * Drop ALL cached patterns for a channel. Used when a mixer/overlay layer's
   * playlist assignment CHANGES or RELOADS (the per-layer retention lives only
   * until the layer's playlist changes), and when a channel is deleted.
   */
  clearChannel(channelId) {
    this._byChannel.delete(channelId);
  }

  /**
   * Drop the entire cache (every channel). Used on performance-mode RESTORE:
   * mid-show tuning must not resurface on later switches.
   */
  clearAll() {
    this._byChannel.clear();
  }

  /** Total number of cached (channel, pattern) entries — introspection only. */
  size() {
    let n = 0;
    for (const byPattern of this._byChannel.values()) n += byPattern.size;
    return n;
  }
}
