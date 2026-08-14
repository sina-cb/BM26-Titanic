/**
 * Global SIZE lock — the ONE place the engine's spatial-scale global is pinned.
 *
 * OPERATOR RULING (2026-08-06): "Set it to 0.5 and do not allow changing it.
 * Add some warning in the engine UI if it's anything but 0.5."
 *
 * WHY. The engine-owned global SIZE fader rescales every pattern coordinate
 * once per frame (`wasm_host.applySizeScale`, driven from `engine.js`
 * `globalSizeMultiplier()`: mult = 0.25 · 16^size, so 0.5 = identity). The
 * titanic scene had `size: 0.773` persisted in `states/titanic/
 * globals_state.yaml` — a ~2.13× multiplier that silently compressed every
 * pattern's visible coordinate range to 0 → ~0.47 and corrupted the
 * operator's calibration readings. With no SIZE control left in any UI
 * (CaptainPad dropped the fader 2026-07-27; the MFT profile never bound it),
 * a stray persisted value is unfixable by the operator. Investigation:
 * `.agent/reports/202608/20260806_181_coordinate_range_story.md`; this lock:
 * `.agent/reports/202608/20260806_182_size_lock.md`.
 *
 * TO UNLOCK (a future operator ruling): delete the guard in
 * `param_center.js` `_setNoFire()` / `_loadFromDisk()` that references
 * `SIZE_LOCK_KEY`, and this module. There is deliberately NO config option
 * and NO env override — codex P0 forbids a fallback path around a hard rule.
 */

// The pinned value. 0.5 on the 0..1 CPC fader === coordinate identity (1×).
export const LOCKED_SIZE = 0.5;

// CPC registry key this module pins.
export const SIZE_LOCK_KEY = 'size';

// `reason` string returned to every refused writer (REST, WS, OSC, timeline,
// state restore). Clients switch on this, so it is part of the wire contract.
export const SIZE_LOCK_REASON = 'size_locked';

// Human-facing refusal text, reused by the engine's HTTP/WS error bodies.
export const SIZE_LOCK_MESSAGE =
  `Global SIZE is LOCKED at ${LOCKED_SIZE} (coordinate identity) by operator ` +
  'ruling 2026-08-06 — writes are refused. The pin lives in ' +
  'marsin_engine/lib/size_lock.js (LOCKED_SIZE).';

// Aggregate refusal logging: the FIRST refusal always prints in full, and so
// does any refusal at least this far after the previous printed one. Nothing
// is ever dropped — every refusal is counted and surfaced on GET /status —
// this only stops a stuck 30 Hz writer (a rogue OSC controller) from
// flooding the console with synchronous writes mid-show.
const REFUSAL_LOG_INTERVAL_MS = 2000;

/**
 * Whether `value` is the pinned size. Tolerant of float noise from YAML /
 * JSON round-trips, strict about everything else (a string "0.5" is NOT the
 * locked value — it is a malformed write and must be reported as one).
 */
export function isLockedSize(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && Math.abs(value - LOCKED_SIZE) < 1e-9;
}

/**
 * Per-ParamCenter record of everything the lock refused. Instance-scoped (not
 * a module singleton) so each engine / test gets a clean slate.
 *
 * Two independent signals:
 *   - `restoreOverrides` — an on-disk file carried a non-locked size at load
 *     (boot restore, snapshot/look recall). Named with the file.
 *   - `refusals` — a runtime writer tried to change it (REST, WS, OSC,
 *     timeline cue globals, CaptainPad, state restore).
 * Either one makes the engine report a warning on GET /status forever after
 * (it never self-clears — the operator must SEE that something is fighting
 * the lock, even if the attempt was hours ago).
 */
export class SizeLockReport {
  constructor() {
    this.locked = LOCKED_SIZE;
    this.restoreOverrides = [];   // [{ file, value }] — capped, count is exact
    this.restoreOverrideCount = 0;
    this.refusalCount = 0;
    this.refusalsBySource = {};   // source → count
    this.lastRefusal = null;      // { value, source, origin }
    this._lastLogMs = 0;
    this._unloggedRefusals = 0;
  }

  /**
   * A persisted file carried a size the lock ignored. Always logs — a restore
   * happens at boot / on an operator recall, never in a loop.
   * @param {string} file — path or filename that carried the value
   * @param {*} value — the ignored value
   */
  noteRestoreOverride(file, value) {
    this.restoreOverrideCount += 1;
    if (this.restoreOverrides.length < 8) {
      this.restoreOverrides.push({ file, value });
    }
    console.error(
      `  ⛔ [size-lock] ${file} carries size=${JSON.stringify(value)} — IGNORED. ` +
      `${SIZE_LOCK_MESSAGE} The engine is running at ${LOCKED_SIZE}; the next ` +
      'globals save rewrites the file with the locked value.');
  }

  /**
   * A runtime writer tried to set size. Always counted; logged in full on the
   * first hit and at most once per REFUSAL_LOG_INTERVAL_MS thereafter (with
   * the suppressed count folded into the next line).
   * @param {*} value
   * @param {string} source
   * @param {string|null} origin
   */
  noteRefusal(value, source, origin) {
    this.refusalCount += 1;
    const src = typeof source === 'string' && source.length > 0 ? source : 'unknown';
    this.refusalsBySource[src] = (this.refusalsBySource[src] || 0) + 1;
    this.lastRefusal = { value, source: src, origin: origin || src };

    const now = Date.now();
    if (this._lastLogMs !== 0 && (now - this._lastLogMs) < REFUSAL_LOG_INTERVAL_MS) {
      this._unloggedRefusals += 1;
      return;
    }
    const suppressed = this._unloggedRefusals > 0
      ? ` (+${this._unloggedRefusals} more refusal(s) since the last line)`
      : '';
    this._lastLogMs = now;
    this._unloggedRefusals = 0;
    console.error(
      `  ⛔ [size-lock] REFUSED size=${JSON.stringify(value)} from ` +
      `source='${src}' origin='${this.lastRefusal.origin}'${suppressed}. ` +
      `${SIZE_LOCK_MESSAGE}`);
  }

  /** True when nothing has ever fought the lock. */
  isClean() {
    return this.restoreOverrideCount === 0 && this.refusalCount === 0;
  }

  /**
   * One-line operator-facing warning, or `null` when clean. This is the
   * string the engine puts on GET /status (`sizeLockWarning`) and CaptainPad
   * renders in its header health chip.
   */
  warningLine() {
    if (this.isClean()) return null;
    const parts = [];
    if (this.restoreOverrideCount > 0) {
      const first = this.restoreOverrides[0];
      parts.push(
        `saved state carried size=${JSON.stringify(first.value)} (${first.file})`);
    }
    if (this.refusalCount > 0) {
      const r = this.lastRefusal;
      parts.push(
        `${this.refusalCount} write(s) refused, last ${JSON.stringify(r.value)} ` +
        `from ${r.source}`);
    }
    return `SIZE locked at ${LOCKED_SIZE} — ${parts.join('; ')}`;
  }

  /** JSON-safe snapshot for GET /status and tests. */
  toJSON() {
    return {
      locked: this.locked,
      clean: this.isClean(),
      warning: this.warningLine(),
      restoreOverrideCount: this.restoreOverrideCount,
      restoreOverrides: this.restoreOverrides.map(o => ({ ...o })),
      refusalCount: this.refusalCount,
      refusalsBySource: { ...this.refusalsBySource },
      lastRefusal: this.lastRefusal ? { ...this.lastRefusal } : null,
    };
  }
}
