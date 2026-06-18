/**
 * JitterBuffer — smooths bursty-but-realtime audio capture into a STEADY hop
 * cadence (docs/37 §13). ffmpeg (even with the low-latency dshow tune) hands us
 * audio in clumps; this buffers hop-sized frames and releases them one per
 * nominal hop period off a drift-corrected wall clock, so the analyzer — and
 * every dt-driven filter downstream (bands, dom Kalman, dance spring, BPM PLL,
 * structure IIRs) — sees an even timeline instead of a jagged one.
 *
 * Pure + deterministic: `push()` enqueues hop frames, `pull(nowMs)` returns the
 * hops DUE by nowMs. Inject the clock in tests; drive it from a real timer +
 * performance.now() in production. No zero-fill on underrun (codex P0 — fail
 * loud / skip, never fabricate audio); a sustained underrun means the source is
 * genuinely behind and the caller should warn.
 *
 * Latency cost = prefillHops · hopMs (default 4 · ~11.6 ms ≈ 46 ms) — well under
 * the 180 ms band release, so it's perceptually invisible. The cap bounds it.
 */
export class JitterBuffer {
  /**
   * @param {object} opts
   * @param {number} opts.hopSamples   — samples per hop frame (the analyzer hop size)
   * @param {number} opts.sampleRate
   * @param {number} [opts.prefillHops=4] — buffered hops before draining starts
   *   (must cover the worst expected inter-arrival gap; 4 ≈ 46 ms covers the
   *   ~49 ms post-dshow-tune gap)
   * @param {number} [opts.maxHops=10]  — hard cap; oldest hops are dropped above
   *   this to bound latency if the source runs fast
   */
  constructor(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('JitterBuffer requires options');
    const hopSamples = opts.hopSamples | 0;
    const sampleRate = +opts.sampleRate;
    if (hopSamples <= 0) throw new RangeError('hopSamples must be > 0');
    if (!(sampleRate > 0)) throw new RangeError('sampleRate must be > 0');
    this.hopSamples = hopSamples;
    this.sampleRate = sampleRate;
    this.hopMs = (hopSamples / sampleRate) * 1000;
    this.prefillHops = opts.prefillHops ?? 4;
    this.maxHops = opts.maxHops ?? 10;
    if (this.maxHops < this.prefillHops) this.maxHops = this.prefillHops;
    this.reset();
  }

  reset() {
    this._q = [];            // queue of hop-sized Int16Array frames
    this._started = false;
    this._startMs = 0;
    this._emitted = 0;       // hops released since start (clock anchor)
    this.underruns = 0;      // hop slots that came due with an empty queue
    this.dropped = 0;        // hops dropped to honour maxHops
  }

  /** Enqueue one hop-sized frame. Drops the oldest if over the cap. */
  push(hopFrame) {
    this._q.push(hopFrame);
    while (this._q.length > this.maxHops) { this._q.shift(); this.dropped++; }
  }

  /** Current backlog depth (hops waiting). */
  get depthHops() { return this._q.length; }

  /**
   * Release the hops due by `nowMs`. Returns an array (0+) of hop frames.
   * Holds a steady cadence pinned to the real clock (no drift); on underrun it
   * advances the clock past the missing slot (skip, never zero-fill) and counts it.
   */
  pull(nowMs) {
    if (!this._started) {
      if (this._q.length < this.prefillHops) return [];   // still pre-filling
      this._started = true; this._startMs = nowMs; this._emitted = 0;
    }
    // +1e-6 absorbs float noise when pulled exactly on a hop boundary.
    const target = Math.floor((nowMs - this._startMs) / this.hopMs + 1e-6) + 1;  // hops that should be out by now
    let want = target - this._emitted;
    if (want <= 0) return [];
    const out = [];
    while (want > 0 && this._q.length > 0) { out.push(this._q.shift()); this._emitted++; want--; }
    if (want > 0) { this.underruns += want; this._emitted += want; }       // skip missing slots, hold cadence
    return out;
  }
}

export default JitterBuffer;
