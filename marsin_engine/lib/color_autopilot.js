import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'config.yaml');

const DEFAULT_DELAY_S = 30;
// Default transition (crossfade) duration when the wire omits the field. 0 ==
// HARD CUT — the historical behavior (palette snaps in instantly). Kept at 0 so
// an upgrade is byte-for-byte visually identical until the operator opts in.
const DEFAULT_TRANSITION_MS = 0;
// Tween cadence: how often the crossfade ramp writes an interpolated frame when
// no `scheduleFrame` hook is injected. ~25 fps is smooth enough for a slow hue
// fade and cheap on the param bus. Tests inject their own clock+scheduler so
// this constant never gates them.
const TWEEN_FRAME_MS = 40;

/**
 * ColorAutopilot — cycles a SET of color palettes on a self-rescheduling
 * timer, applying one palette every `delay_s` seconds. This is the palette
 * analogue of the pattern Autopilot (lib/autopilot.js): same generation-guard
 * timer model, but it advances a palette (CPC colour pair) instead of a deck
 * pattern. The two run in PARALLEL and never touch each other's state — color
 * cycling does not change the running pattern.
 *
 * Timer model (mirrors Autopilot, docs/39):
 *   wait delay_s  →  apply next palette  →  repeat
 * Every state change (active / palettes / delay_s / shuffle / transitionMs)
 * bumps a `generation` counter. A scheduled tick captures the gen at schedule
 * time and bails on fire if it no longer matches — deterministic stop
 * semantics: when you deactivate, no further cycles run even if a tick was
 * already queued.
 *
 * Palette resolution is INJECTED, not done here: `applyPaletteFn(paletteId)`
 * resolves the id → CPC params and writes them (the engine wires this to the
 * SAME `_resolvePalette` → `setParams` path the timeline/look bundles use). An
 * unknown palette id makes `applyPaletteFn` throw — we surface that loudly
 * (codex P0: no silent skip).
 *
 * CROSSFADE (transitionMs): when `transitionMs > 0` and the optional crossfade
 * hooks are injected (resolvePaletteFn + applyParamsFn), a palette switch RAMPS
 * the palette params from the currently-applied set to the target set over
 * `transitionMs` instead of hard-cutting. The ramp is interpolated per frame on
 * an injected clock/scheduler (the engine uses real timers; tests step a fake
 * clock). transitionMs === 0 is a HARD CUT (the historical behavior) and uses
 * `applyPaletteFn` directly. Reconfig / pause CANCELS an in-flight tween
 * cleanly (the generation guard makes a stale frame a no-op).
 *
 * Wire shape (the persisted + REST + cue contract):
 *   { active: boolean, palettes: string[] (>=1 known id), delay_s: number > 0,
 *     shuffle?: boolean (default false), transitionMs?: number >= 0 (default 0) }
 */
export class ColorAutopilot {
  /**
   * @param {(paletteId: string) => (void|Promise)} applyPaletteFn — resolve +
   *   apply a palette id (throws on unknown id; may be async). Used for HARD
   *   CUTS (transitionMs === 0) and as the fallback when no crossfade hooks are
   *   injected.
   * @param {string} [configFile] — persistence path; defaults to the engine's
   *   config.yaml. Injected by tests so they don't touch the real config.
   * @param {object} [hooks] — optional crossfade wiring:
   *   - resolvePaletteFn(id) => params : resolve a palette id to a params object
   *     (throws on unknown id). REQUIRED for crossfade.
   *   - applyParamsFn(params) => void : write an (already-interpolated) params
   *     object to the rig. REQUIRED for crossfade.
   *   - now() => number : monotonic ms clock (defaults to Date.now). Injected by
   *     tests so the tween advances on a fake clock.
   *   - scheduleFrame(fn, ms) => handle : schedule the next tween frame
   *     (defaults to a unref'd setTimeout). Returns a handle for clearFrame.
   *   - clearFrame(handle) => void : cancel a scheduled frame (defaults to
   *     clearTimeout).
   */
  constructor(applyPaletteFn, configFile, hooks = {}) {
    if (typeof applyPaletteFn !== 'function') {
      throw new Error('ColorAutopilot: applyPaletteFn is required');
    }
    this.applyPalette = applyPaletteFn;
    this.configFile = configFile || CONFIG_FILE;
    this.cycleTimer = null;
    // Crossfade hooks (optional). When resolve+apply are both present, a switch
    // with transitionMs>0 ramps instead of hard-cutting.
    this.resolvePalette = typeof hooks.resolvePaletteFn === 'function' ? hooks.resolvePaletteFn : null;
    this.applyParams = typeof hooks.applyParamsFn === 'function' ? hooks.applyParamsFn : null;
    this._now = typeof hooks.now === 'function' ? hooks.now : () => Date.now();
    this._scheduleFrame = typeof hooks.scheduleFrame === 'function'
      ? hooks.scheduleFrame
      : (fn, ms) => {
        const t = setTimeout(fn, ms);
        if (typeof t.unref === 'function') t.unref();
        return t;
      };
    this._clearFrame = typeof hooks.clearFrame === 'function' ? hooks.clearFrame : (h) => clearTimeout(h);
    // In-flight crossfade tween (null when none). Holds the active frame handle
    // + the params we last wrote so a follow-on switch ramps FROM where we are.
    this._tween = null;
    // The params currently applied to the rig — the START point of the next
    // crossfade. null until the first palette is applied.
    this._currentParams = null;
    // generation counter: bumped on every state change. A scheduled tick
    // captures the current gen at schedule time and bails on execution if it
    // doesn't match (someone changed state between schedule and fire). Also
    // cancels any in-flight tween (a stale tween frame becomes a no-op).
    this.generation = 0;
    // Optional hook fired on EVERY (re)schedule so the server can re-broadcast
    // the fresh next-swap time for the deck color-autopilot countdown (operator
    // request 2026-07-02).
    this.onSchedule = typeof hooks.onSchedule === 'function' ? hooks.onSchedule : null;
    // Injected-clock ms when the next palette switch fires (null when inactive).
    this._nextSwapAtMs = null;
    // Sequential cursor — index of the LAST applied palette in this.state.palettes.
    // -1 means "nothing applied yet"; the first tick applies index 0.
    this._cursor = -1;
    this.config = this.loadConfig();

    if (!this.config.colorAutopilot) {
      this.config.colorAutopilot = {
        active: false,
        palettes: [],
        delay_s: DEFAULT_DELAY_S,
        shuffle: false,
        transitionMs: DEFAULT_TRANSITION_MS,
      };
      this.saveConfig();
    }
  }

  loadConfig() {
    if (fs.existsSync(this.configFile)) {
      return yaml.load(fs.readFileSync(this.configFile, 'utf8')) || {};
    }
    return {};
  }

  saveConfig() {
    fs.writeFileSync(this.configFile, yaml.dump(this.config));
  }

  get state() {
    return this.config.colorAutopilot
      || { active: false, palettes: [], delay_s: DEFAULT_DELAY_S, shuffle: false, transitionMs: DEFAULT_TRANSITION_MS };
  }

  /**
   * Validate + normalize a colorAutopilot wire object. THROW-style (codex P0):
   * a bad shape fails loud, never coerces silently. `knownIds` (optional) is a
   * Set of valid palette ids — when provided, every palette must be a member.
   * Returns { active, palettes, delay_s, shuffle, transitionMs }.
   */
  static validate(obj, knownIds) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('colorAutopilot must be an object { active, palettes, delay_s, shuffle?, transitionMs? }');
    }
    if (typeof obj.active !== 'boolean') {
      throw new Error(`colorAutopilot.active must be a boolean, got ${JSON.stringify(obj.active)}`);
    }
    if (!Array.isArray(obj.palettes) || obj.palettes.length === 0) {
      throw new Error('colorAutopilot.palettes must be a non-empty array of palette ids');
    }
    obj.palettes.forEach((id, i) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error(`colorAutopilot.palettes[${i}] must be a non-empty string, got ${JSON.stringify(id)}`);
      }
      if (knownIds && !knownIds.has(id)) {
        throw new Error(`colorAutopilot.palettes[${i}] "${id}" is not a known palette id`);
      }
    });
    if (typeof obj.delay_s !== 'number' || Number.isNaN(obj.delay_s) || obj.delay_s <= 0) {
      throw new Error(`colorAutopilot.delay_s must be a number > 0, got ${JSON.stringify(obj.delay_s)}`);
    }
    let shuffle = false;
    if (obj.shuffle !== undefined) {
      if (typeof obj.shuffle !== 'boolean') {
        throw new Error(`colorAutopilot.shuffle must be a boolean, got ${JSON.stringify(obj.shuffle)}`);
      }
      shuffle = obj.shuffle;
    }
    // transitionMs: optional, non-negative finite number. 0 == hard cut. A
    // negative / NaN / non-number value is an authoring error → throw loud.
    let transitionMs = DEFAULT_TRANSITION_MS;
    if (obj.transitionMs !== undefined) {
      if (typeof obj.transitionMs !== 'number' || !Number.isFinite(obj.transitionMs) || obj.transitionMs < 0) {
        throw new Error(`colorAutopilot.transitionMs must be a number >= 0, got ${JSON.stringify(obj.transitionMs)}`);
      }
      transitionMs = obj.transitionMs;
    }
    return { active: obj.active, palettes: [...obj.palettes], delay_s: obj.delay_s, shuffle, transitionMs };
  }

  /**
   * Replace the colorAutopilot config (already-validated shape), persist it,
   * and (re)start the cycle. Bumps generation FIRST so any in-flight tick reads
   * the new gen and bails before doing work. Resets the sequential cursor so a
   * config change starts the new palette set from the top. Any in-flight
   * crossfade tween is cancelled (reconfig is a clean break).
   */
  setState(newState) {
    this.config.colorAutopilot = {
      active: newState.active,
      palettes: [...newState.palettes],
      delay_s: newState.delay_s,
      shuffle: newState.shuffle !== undefined ? newState.shuffle : false,
      transitionMs: newState.transitionMs !== undefined ? newState.transitionMs : DEFAULT_TRANSITION_MS,
    };
    this._cursor = -1;
    this._cancelTween();
    this.saveConfig();
    this.generation++;
    this._scheduleNext();
  }

  start() {
    this._scheduleNext();
  }

  /**
   * Schedule the next tick `delay_s` seconds from now, if active. Clears any
   * existing timer first. Captures the current generation so the scheduled
   * callback can bail if state has since changed.
   */
  _scheduleNext() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    const st = this.state;
    if (!st.active || !Array.isArray(st.palettes) || st.palettes.length === 0) {
      this._nextSwapAtMs = null;
      if (this.onSchedule) this.onSchedule();
      return;
    }
    const delayMs = (Number(st.delay_s) > 0 ? Number(st.delay_s) : DEFAULT_DELAY_S) * 1000;
    const gen = this.generation;
    this._nextSwapAtMs = this._now() + delayMs;
    this.cycleTimer = setTimeout(() => {
      this._runTick(gen).catch((e) => {
        console.warn('[ColorAutopilot] tick failed:', e && e.message ? e.message : e);
      });
    }, delayMs);
    // Don't keep the event loop alive solely for the color cycle (mirrors the
    // bump-sweep timer): the engine stays up via its HTTP server, and tests must
    // not hang on a pending palette tick.
    if (typeof this.cycleTimer.unref === 'function') this.cycleTimer.unref();
    if (this.onSchedule) this.onSchedule();
  }

  /** Injected-clock ms when the next palette switch fires, or null when inactive. */
  get nextSwapAtMs() {
    return this.state.active && typeof this._nextSwapAtMs === 'number' ? this._nextSwapAtMs : null;
  }

  // Stop the cycle (clears the pending timer + any in-flight crossfade tween).
  // Idempotent.
  stop() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    this._cancelTween();
  }

  /**
   * DEACTIVATE the palette cycle: persist active:false (so it stays stopped
   * across a restart / start()) AND stop the running cycle. Idempotent — a no-op
   * when already inactive. Used by the timeline deck-pin release path (docs/38
   * §16.11): when the plan stops driving the deck, the color daemon must stop
   * too, symmetric to releaseDeckView. Bumps generation so any in-flight tick
   * bails. Returns the new state.
   */
  deactivate() {
    const st = this.state;
    if (st.active) {
      this.config.colorAutopilot = { ...st, active: false };
      this.saveConfig();
      this.generation++;
    }
    this.stop();
    return this.state;
  }

  /**
   * Apply one palette advance. Bails if state changed since schedule time.
   * Picks the NEXT palette (random when shuffle, else sequential), applies it
   * (hard cut or crossfade per transitionMs), then schedules the next tick if
   * still active. A throwing palette resolve/apply (e.g. an unknown id)
   * propagates — the caller's .catch logs it loud; we do NOT silently skip a
   * bad palette (codex P0).
   */
  async _runTick(scheduledGen) {
    if (scheduledGen !== this.generation) return;
    const st = this.state;
    if (!st.active || !Array.isArray(st.palettes) || st.palettes.length === 0) return;

    const id = this._pickNext(st);
    await this._applyPalette(id, st, scheduledGen);

    if (scheduledGen !== this.generation) return;
    if (!this.state.active) return;
    this._scheduleNext();
  }

  /**
   * Apply a palette id either as a HARD CUT (transitionMs === 0, or no crossfade
   * hooks injected) or as a CROSSFADE ramp. The crossfade interpolates every
   * numeric leaf of the resolved params object from the currently-applied params
   * to the target params over transitionMs.
   */
  async _applyPalette(id, st, gen) {
    const transitionMs = Number(st.transitionMs) > 0 ? Number(st.transitionMs) : 0;
    const canCrossfade = transitionMs > 0 && this.resolvePalette && this.applyParams;

    if (!canCrossfade) {
      // Hard cut: write the palette directly. Keep _currentParams in sync (when
      // we can resolve) so a LATER crossfade ramps from the right start point.
      const ret = this.applyPalette(id);
      if (ret && typeof ret.then === 'function') await ret;
      if (this.resolvePalette) {
        try { this._currentParams = this.resolvePalette(id); } catch { /* resolve already validated upstream */ }
      }
      return;
    }

    // Resolve target params loudly (unknown id throws — codex P0).
    const target = this.resolvePalette(id);
    const from = this._currentParams;
    // No known start point yet → snap to target (the first applied palette has
    // nothing to fade FROM). Subsequent switches ramp.
    if (!from) {
      this.applyParams(target);
      this._currentParams = target;
      return;
    }
    await this._runTween(from, target, transitionMs, gen);
  }

  /**
   * Drive a crossfade tween from `from` params to `to` params over durationMs.
   * Writes an interpolated frame every TWEEN_FRAME_MS (or per the injected
   * scheduler). Resolves when the tween reaches the target or is cancelled by a
   * generation bump (reconfig / pause). The final frame writes the EXACT target
   * so no rounding residue is left behind.
   */
  _runTween(from, to, durationMs, gen) {
    this._cancelTween();
    const start = this._now();
    return new Promise((resolve) => {
      const step = () => {
        // Stale tween (state changed under us) → abandon WITHOUT writing.
        if (gen !== this.generation) {
          this._tween = null;
          resolve();
          return;
        }
        const elapsed = this._now() - start;
        const t = durationMs > 0 ? Math.min(1, elapsed / durationMs) : 1;
        const frame = lerpParams(from, to, t);
        this.applyParams(frame);
        this._currentParams = frame;
        if (t >= 1) {
          // Land exactly on target to avoid float residue.
          this.applyParams(to);
          this._currentParams = to;
          this._tween = null;
          resolve();
          return;
        }
        this._tween = { handle: this._scheduleFrame(step, TWEEN_FRAME_MS), resolve };
      };
      // Fire the first frame immediately so the ramp starts moving on the tick.
      step();
    });
  }

  // Cancel an in-flight crossfade tween (clears its scheduled frame + resolves
  // its promise). Idempotent. Does NOT roll back already-written params — the
  // next switch ramps from wherever the fade was interrupted.
  _cancelTween() {
    if (this._tween) {
      const { handle, resolve } = this._tween;
      this._tween = null;
      if (handle !== undefined && handle !== null) this._clearFrame(handle);
      if (typeof resolve === 'function') resolve();
    }
  }

  // Pick the next palette id: sequential (advance the cursor with wrap) or, when
  // shuffle is on, a random pick that avoids repeating the immediately-previous
  // palette when the set has more than one entry.
  _pickNext(st) {
    const palettes = st.palettes;
    if (st.shuffle && palettes.length > 1) {
      let idx;
      do {
        idx = Math.floor(Math.random() * palettes.length);
      } while (idx === this._cursor);
      this._cursor = idx;
      return palettes[idx];
    }
    this._cursor = (this._cursor + 1) % palettes.length;
    return palettes[this._cursor];
  }

  // Back-compat / test shim: manually advance one step (no scheduling).
  triggerNext() {
    return this._runTick(this.generation);
  }
}

/**
 * Linearly interpolate every numeric leaf of `to` from the matching leaf in
 * `from` by factor t in [0,1]. Params are shallow objects of either numbers or
 * small {h,s,v}-style sub-objects (the color-palette shape), so we recurse one
 * level into plain objects. A non-numeric / structurally-mismatched leaf snaps
 * to the target value (no interpolation defined). Pure — returns a fresh object.
 */
export function lerpParams(from, to, t) {
  const out = {};
  for (const k in to) {
    const a = from ? from[k] : undefined;
    const b = to[k];
    if (typeof b === 'number' && typeof a === 'number') {
      out[k] = a + (b - a) * t;
    } else if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) {
      out[k] = lerpParams(a, b, t);
    } else {
      out[k] = b;
    }
  }
  return out;
}
