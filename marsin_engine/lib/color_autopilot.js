import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'config.yaml');

const DEFAULT_DELAY_S = 30;

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
 * Every state change (active / palettes / delay_s / shuffle) bumps a
 * `generation` counter. A scheduled tick captures the gen at schedule time and
 * bails on fire if it no longer matches — deterministic stop semantics: when
 * you deactivate, no further cycles run even if a tick was already queued.
 *
 * Palette resolution is INJECTED, not done here: `applyPaletteFn(paletteId)`
 * resolves the id → CPC params and writes them (the engine wires this to the
 * SAME `_resolvePalette` → `setParams` path the timeline/look bundles use). An
 * unknown palette id makes `applyPaletteFn` throw — we surface that loudly
 * (codex P0: no silent skip).
 *
 * Wire shape (the persisted + REST + cue contract):
 *   { active: boolean, palettes: string[] (>=1 known id), delay_s: number > 0,
 *     shuffle?: boolean (default false) }
 */
export class ColorAutopilot {
  /**
   * @param {(paletteId: string) => (void|Promise)} applyPaletteFn — resolve +
   *   apply a palette id (throws on unknown id; may be async).
   * @param {string} [configFile] — persistence path; defaults to the engine's
   *   config.yaml. Injected by tests so they don't touch the real config.
   */
  constructor(applyPaletteFn, configFile) {
    if (typeof applyPaletteFn !== 'function') {
      throw new Error('ColorAutopilot: applyPaletteFn is required');
    }
    this.applyPalette = applyPaletteFn;
    this.configFile = configFile || CONFIG_FILE;
    this.cycleTimer = null;
    // generation counter: bumped on every state change. A scheduled tick
    // captures the current gen at schedule time and bails on execution if it
    // doesn't match (someone changed state between schedule and fire).
    this.generation = 0;
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
      || { active: false, palettes: [], delay_s: DEFAULT_DELAY_S, shuffle: false };
  }

  /**
   * Validate + normalize a colorAutopilot wire object. THROW-style (codex P0):
   * a bad shape fails loud, never coerces silently. `knownIds` (optional) is a
   * Set of valid palette ids — when provided, every palette must be a member.
   * Returns { active, palettes, delay_s, shuffle }.
   */
  static validate(obj, knownIds) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('colorAutopilot must be an object { active, palettes, delay_s, shuffle? }');
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
    return { active: obj.active, palettes: [...obj.palettes], delay_s: obj.delay_s, shuffle };
  }

  /**
   * Replace the colorAutopilot config (already-validated shape), persist it,
   * and (re)start the cycle. Bumps generation FIRST so any in-flight tick reads
   * the new gen and bails before doing work. Resets the sequential cursor so a
   * config change starts the new palette set from the top.
   */
  setState(newState) {
    this.config.colorAutopilot = {
      active: newState.active,
      palettes: [...newState.palettes],
      delay_s: newState.delay_s,
      shuffle: newState.shuffle !== undefined ? newState.shuffle : false,
    };
    this._cursor = -1;
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
    if (!st.active || !Array.isArray(st.palettes) || st.palettes.length === 0) return;
    const delayMs = (Number(st.delay_s) > 0 ? Number(st.delay_s) : DEFAULT_DELAY_S) * 1000;
    const gen = this.generation;
    this.cycleTimer = setTimeout(() => {
      this._runTick(gen).catch((e) => {
        console.warn('[ColorAutopilot] tick failed:', e && e.message ? e.message : e);
      });
    }, delayMs);
    // Don't keep the event loop alive solely for the color cycle (mirrors the
    // bump-sweep timer): the engine stays up via its HTTP server, and tests must
    // not hang on a pending palette tick.
    if (typeof this.cycleTimer.unref === 'function') this.cycleTimer.unref();
  }

  // Stop the cycle (clears the pending timer). Idempotent.
  stop() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  /**
   * Apply one palette advance. Bails if state changed since schedule time.
   * Picks the NEXT palette (random when shuffle, else sequential), applies it,
   * then schedules the next tick if still active. A throwing applyPalette (e.g.
   * an unknown id) propagates — the caller's .catch logs it loud; we do NOT
   * silently skip a bad palette (codex P0).
   */
  async _runTick(scheduledGen) {
    if (scheduledGen !== this.generation) return;
    const st = this.state;
    if (!st.active || !Array.isArray(st.palettes) || st.palettes.length === 0) return;

    const id = this._pickNext(st);
    const ret = this.applyPalette(id);
    if (ret && typeof ret.then === 'function') await ret;

    if (scheduledGen !== this.generation) return;
    if (!this.state.active) return;
    this._scheduleNext();
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
