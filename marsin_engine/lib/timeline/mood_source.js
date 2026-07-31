/**
 * mood_source.js — the show director's MOOD reader, with a staleness guard.
 *
 * ── The single-point failure this closes ──────────────────────────────────────
 * The timeline reads its mood from ONE CPC key (`timeline.mood.key`, now
 * `audioPartyStrong`). That key is produced by the Audio Companion — a separate
 * process. If the companion dies, is killed, loses its mic, or its OSC path
 * breaks, the CPC does not go quiet: it FREEZES at the last value it received.
 * A frozen `1` pins the rig in party mode forever, and nothing anywhere says
 * why. That is exactly the "sits in party mode all the time" failure, arrived at
 * from the other direction.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A mood value is only trusted while it is being ACTIVELY REPUBLISHED. Freshness
 * is measured on the CPC WRITE REVISION, not on the value: the companion emits
 * `audioPartyStrong` at 5 Hz and every packet bumps the key's revision even when
 * the value is unchanged, so a still revision means the PRODUCER stopped — which
 * is the thing we actually care about.
 *
 *   fresh  → report the real value.
 *   stale  → report CALM (party 0, value 0), i.e. drop to the ambient program.
 *
 * ── This is a DESIGNED FAILURE STATE, not a silent fallback (codex P0) ────────
 * Dropping to ambient is the SAFE and CORRECT show behaviour, but it must never
 * be invisible. So the guard:
 *   1. logs LOUDLY on the stale edge (console.error) and again on recovery,
 *   2. carries `stale`, `staleForSec`, `rawValue` and `key` out to the caller,
 *      which surfaces them on `GET /timeline/state` and the timeline WS state,
 *   3. counts stale episodes so a flapping companion is visible after the fact.
 * The operator can therefore see, on the API, that party detection is DOWN and
 * that the ambient program is running BECAUSE of that — not guess at it.
 *
 * Pure and injectable: `nowFn` and `logger` are parameters so the guard is unit
 * testable without a clock or a console.
 */

export const MOOD_SOURCE_DEFAULTS = Object.freeze({
  // Seconds without a republish before the mood key is declared stale. The
  // companion publishes at 5 Hz, so 10 s is ~50 missed frames — far outside any
  // scheduling hiccup, well inside "the operator would notice the lights".
  staleSec: 10,
});

export class MoodSource {
  /**
   * @param {object} o
   * @param {object} o.paramCenter      — CPC (needs get / isRegisteredKey / getLastRevision)
   * @param {string} o.key              — the mood CPC key (config `timeline.mood.key`)
   * @param {number} o.partyThreshold   — value ≥ this ⇒ party
   * @param {number} [o.staleSec]       — freshness budget, seconds
   * @param {() => number} [o.nowFn]    — epoch ms clock (injectable for tests)
   * @param {object} [o.logger]         — { error, warn } (injectable for tests)
   */
  constructor({ paramCenter, key, partyThreshold, staleSec, nowFn, logger }) {
    if (!paramCenter || typeof paramCenter.get !== 'function') {
      throw new TypeError('MoodSource: paramCenter with get() is required');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('MoodSource: a mood key string is required');
    }
    if (!Number.isFinite(partyThreshold)) {
      throw new TypeError('MoodSource: partyThreshold must be a finite number');
    }
    const budget = staleSec === undefined ? MOOD_SOURCE_DEFAULTS.staleSec : staleSec;
    if (!Number.isFinite(budget) || budget <= 0) {
      throw new TypeError(`MoodSource: staleSec must be a number > 0, got ${JSON.stringify(staleSec)}`);
    }
    this.paramCenter = paramCenter;
    this.key = key;
    this.partyThreshold = partyThreshold;
    this.staleSec = budget;
    this.nowFn = typeof nowFn === 'function' ? nowFn : Date.now;
    this.logger = logger || console;

    this._lastRevision = null;      // last observed CPC write revision
    this._lastFreshMs = null;       // clock at the last observed revision CHANGE
    this._anchorMs = this.nowFn();  // boot anchor: "never published" ages from here
    this._stale = false;
    this.staleEpisodes = 0;
    this.lastStaleAtMs = null;
    this.lastRecoveredAtMs = null;
  }

  /**
   * Read the mood, applying the staleness guard.
   * @returns {{party:0|1, value:number, stale:boolean, staleForSec:number,
   *            key:string, rawValue:number|null, staleSec:number,
   *            staleEpisodes:number}}
   */
  read() {
    const now = this.nowFn();
    const pc = this.paramCenter;

    // An UNREGISTERED key is not a stale key — it is a misconfiguration. Report
    // rawValue null so the operator can tell "wrong key name in config" from
    // "companion died"; both drop to calm, but for different, VISIBLE reasons.
    const registered = typeof pc.isRegisteredKey === 'function'
      ? pc.isRegisteredKey(this.key) : true;
    let rawValue = null;
    if (registered) {
      const v = pc.get(this.key);
      if (typeof v === 'number') rawValue = v;
      else if (v && typeof v.value === 'number') rawValue = v.value;
    }

    // Freshness = the write revision moved. Every republish bumps it, even when
    // the value repeats — that is what distinguishes "alive" from "frozen".
    const rev = (registered && typeof pc.getLastRevision === 'function')
      ? pc.getLastRevision(this.key) : null;
    if (rev !== null && rev !== this._lastRevision) {
      this._lastRevision = rev;
      // Revision 0 means "registered but never written" — do NOT treat that as
      // a publish, or a dead companion would read fresh forever at boot.
      if (rev > 0) this._lastFreshMs = now;
    }

    const sinceMs = this._lastFreshMs === null
      ? now - this._anchorMs          // never published: age from boot
      : now - this._lastFreshMs;
    const stale = !registered || sinceMs > this.staleSec * 1000;

    // Loud edges — a designed failure state must be SEEN.
    if (stale && !this._stale) {
      this._stale = true;
      this.staleEpisodes++;
      this.lastStaleAtMs = now;
      const why = registered
        ? `no republish for ${(sinceMs / 1000).toFixed(1)} s (budget ${this.staleSec} s)`
        : 'key is NOT REGISTERED on the CPC (check timeline.mood.key in config.yaml)';
      this.logger.error(
        `  ❌ [timeline] MOOD SOURCE STALE — "${this.key}" ${why}. `
        + 'Party detection is DOWN (audio companion?); forcing mood → CALM so the '
        + 'show falls back to the ambient program instead of freezing in party mode.');
    } else if (!stale && this._stale) {
      this._stale = false;
      this.lastRecoveredAtMs = now;
      this.logger.warn(
        `  ✅ [timeline] mood source RECOVERED — "${this.key}" is republishing again `
        + `(was stale for ${((now - this.lastStaleAtMs) / 1000).toFixed(1)} s).`);
    }

    const value = stale ? 0 : (rawValue === null ? 0 : rawValue);
    return {
      party: value >= this.partyThreshold ? 1 : 0,
      value,
      stale,
      staleForSec: +(sinceMs / 1000).toFixed(1),
      staleSec: this.staleSec,
      key: this.key,
      // The value the CPC actually holds, even while we are ignoring it — this
      // is how the operator sees a FROZEN 1 being correctly refused.
      rawValue,
      staleEpisodes: this.staleEpisodes,
    };
  }
}

export default MoodSource;
