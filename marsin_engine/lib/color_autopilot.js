import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

import { SCHEME_IDS, generateScheme } from './color_schemes.js';
import { ColorAutopilotTransition } from './color_autopilot_transition.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Default persistence target when no explicit configFile is injected. Tests set
// MARSIN_CONFIG_FILE to a scratch copy so the tracked, comment-bearing
// config.yaml is never rewritten; the spawned engine inherits it. Unset in
// production → the real config.yaml.
const CONFIG_FILE = process.env.MARSIN_CONFIG_FILE || path.join(__dirname, '..', 'config.yaml');

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
// CONTINUOUS mode floor (docs/55 §3.1): with `delay_s: 0` the cycle is
// back-to-back fades, so the FADE is the only thing occupying the cycle. A
// zero (or near-zero) fade there would be a hard-cut spin loop flooding the
// CPC at timer resolution — refused loudly rather than clamped.
const MIN_CONTINUOUS_TRANSITION_MS = 100;

// ── FOLLOW NOTE (docs/59) ───────────────────────────────────────────────────
// The two CPC keys the mode reads. They are published by the audio companion's
// DerivedSignals at 10 Hz (audio/postproc/audio_signals.js) and, critically,
// the companion HOLDS the last committed pitch class through silence — so
// "what happens when the music stops" is answered upstream by a tested
// contract, not by a fallback here (docs/59 §8).
export const NOTE_PC_KEY = 'audioNote';
export const NOTE_HUE_KEY = 'audioNoteHue';
// The two mode discriminators the wire may carry. ABSENT ≡ 'palettes', so every
// config written before this feature existed is byte-unchanged AND
// byte-understood.
export const COLOR_AUTOPILOT_MODES = ['palettes', 'followNote'];
// Ring length every scheme generator produces; `sel` indexes into it.
const RING_LENGTH = 5;
// Defaults for the follow-note block, matching the UI's default pills
// (docs/59 §7): a 60 s method hold, a 3 s method crossfade ("cycling smoothly"
// is the order — 0.4 s is a cut, not a cycle), and a 400 ms note slew (Live
// Touch snaps because it repaints a preview glass; on a 30 m ship an instant
// 180° two-slot jump reads as a fault).
const DEFAULT_METHOD_HOLD_S = 60;
const DEFAULT_METHOD_FADE_S = 3;
const DEFAULT_NOTE_FADE_MS = 400;
const DEFAULT_SEL = [0, 1];
// CONTINUOUS-mode floor for the METHOD cycle, the same rule (and the same
// refusal sentence family) `delay_s: 0` already obeys, expressed in seconds.
const MIN_CONTINUOUS_METHOD_FADE_S = MIN_CONTINUOUS_TRANSITION_MS / 1000;

const KNOWN_SCHEMES = new Set(SCHEME_IDS);

/** Which mode is this (possibly legacy) wire/state object in? ABSENT ≡ palettes. */
export function colorAutopilotMode(obj) {
  return obj && obj.mode === 'followNote' ? 'followNote' : 'palettes';
}

/**
 * Validate + normalize the `followNote` block (docs/59 §4.1). THROW-style
 * (codex P0) — every refusal names the field and the value it saw, because
 * this block reaches the engine from three doors (REST, a timeline cue, a
 * persisted runtime file) and a config that half-applied would leave the rig
 * following the music with a cycle nobody configured.
 *
 * Returns a fresh, fully-populated block: nothing downstream ever has to ask
 * "was this field supplied?", which is what keeps the two loops from disagreeing
 * about a default.
 */
export function validateFollowNote(obj, label = 'colorAutopilot.followNote') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${label} must be an object { schemes, methodHoldS, methodFadeS, noteFadeMs, sel, shuffle? }`);
  }
  if (!Array.isArray(obj.schemes) || obj.schemes.length === 0) {
    throw new Error(`${label}.schemes must be a non-empty array of scheme ids (${SCHEME_IDS.join(', ')})`);
  }
  const seen = new Set();
  const schemes = obj.schemes.map((id, i) => {
    if (typeof id !== 'string' || !KNOWN_SCHEMES.has(id)) {
      throw new Error(`${label}.schemes[${i}] "${id}" is not a known scheme id — expected one of ${SCHEME_IDS.join(', ')}`);
    }
    // A repeat is not harmless: the cycle would linger twice as long on that
    // method for no stated reason, and the chip row (a SET of toggles) cannot
    // represent it — so the wire must not be able to say it either.
    if (seen.has(id)) throw new Error(`${label}.schemes lists "${id}" twice — the cycle is a SET of methods`);
    seen.add(id);
    return id;
  });
  const methodHoldS = numberField(obj.methodHoldS, `${label}.methodHoldS`, DEFAULT_METHOD_HOLD_S, 0);
  const methodFadeS = numberField(obj.methodFadeS, `${label}.methodFadeS`, DEFAULT_METHOD_FADE_S, 0);
  if (!(methodFadeS > 0)) {
    throw new Error(`${label}.methodFadeS must be a number > 0, got ${JSON.stringify(obj.methodFadeS)}`);
  }
  // The spin-loop rule, in the method cycle's own units: zero hold means the
  // fades run back to back, so a near-zero fade there is a hard-cut loop
  // hammering the CPC at timer resolution. Refused, never clamped.
  if (methodHoldS === 0 && methodFadeS < MIN_CONTINUOUS_METHOD_FADE_S) {
    throw new Error(
      `${label}.methodHoldS 0 (continuous) requires methodFadeS >= ${MIN_CONTINUOUS_METHOD_FADE_S}, `
      + `got ${JSON.stringify(obj.methodFadeS)}`);
  }
  const noteFadeMs = numberField(obj.noteFadeMs, `${label}.noteFadeMs`, DEFAULT_NOTE_FADE_MS, 0);
  const sel = validateSel(obj.sel, `${label}.sel`);
  let shuffle = false;
  if (obj.shuffle !== undefined) {
    if (typeof obj.shuffle !== 'boolean') {
      throw new Error(`${label}.shuffle must be a boolean, got ${JSON.stringify(obj.shuffle)}`);
    }
    shuffle = obj.shuffle;
  }
  const out = { schemes, methodHoldS, methodFadeS, noteFadeMs, sel, shuffle };
  // `method` is the CURRENT generator — the scheme-tap override's landing field
  // (docs/59 §6). It is deliberately allowed to name a scheme that is NOT in
  // the cycle subset: tapping a chip that is toggled off means "show me this
  // one NOW", and the cycle then resumes from the subset. Any id outside the
  // nine is still a hard refusal.
  if (obj.method !== undefined) {
    if (typeof obj.method !== 'string' || !KNOWN_SCHEMES.has(obj.method)) {
      throw new Error(`${label}.method "${obj.method}" is not a known scheme id — expected one of ${SCHEME_IDS.join(', ')}`);
    }
    out.method = obj.method;
  }
  return out;
}

/** A finite number >= min, or `fallback` when absent. Throws otherwise. */
function numberField(value, label, fallback, min) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${label} must be a number >= ${min}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The two ring slots feeding colorPalette1/2 — two DISTINCT indices in [0,5). */
function validateSel(value, label) {
  if (value === undefined) return [...DEFAULT_SEL];
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a two-element array of ring indices, got ${JSON.stringify(value)}`);
  }
  const sel = value.map((i, k) => {
    if (!Number.isInteger(i) || i < 0 || i >= RING_LENGTH) {
      throw new Error(`${label}[${k}] must be an integer ring index in [0,${RING_LENGTH}), got ${JSON.stringify(i)}`);
    }
    return i;
  });
  if (sel[0] === sel[1]) {
    throw new Error(`${label} picks slot ${sel[0]} for BOTH channels — A and B would be the same colour`);
  }
  return sel;
}

/**
 * Validate ONE channel of an inline palette pair (D2, docs/55 §1). A channel is
 * EITHER a hue number in [0,1] (the historical wire — resolves to s=1, v=1
 * downstream) OR a full `{h,s,v}` object with every channel a finite number in
 * [0,1]. Returns the accepted value, DEEP-COPIED for the object form so daemon
 * state can never mutate under a wire object the caller still holds.
 *
 * `label` is the operator-facing path of the value ("colorAutopilot.palettes[2].c1"
 * / "inline palette c1") so a rejection names exactly which entry and channel
 * is wrong — the resolver in api_server.js reuses this so the two front doors
 * cannot disagree about what a legal pair is.
 */
export function validatePaletteChannel(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const ch of ['h', 's', 'v']) {
      const n = value[ch];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error(`${label}.${ch} must be a number in [0,1], got ${JSON.stringify(n)}`);
      }
    }
    return { h: value.h, s: value.s, v: value.v };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `${label} must be a hue number in [0,1] or an {h,s,v} object, got ${JSON.stringify(value)}`);
  }
  return value;
}

function asFullHsv(value) {
  return typeof value === 'number'
    ? { h: value, s: 1, v: 1 }
    : { h: value.h, s: value.s, v: value.v };
}

function sameHsv(a, b) {
  return a.h === b.h && a.s === b.s && a.v === b.v;
}

/** Validate the explicit five-slot target parallel to every palette entry. */
function validateLivePalettes(value, palettes, label = 'colorAutopilot.livePalettes') {
  if (!Array.isArray(value) || value.length !== palettes.length) {
    throw new Error(
      `${label} must be an array with the same length as colorAutopilot.palettes `
      + `(${palettes.length}), got ${Array.isArray(value) ? value.length : JSON.stringify(value)}`,
    );
  }
  return value.map((state, stateIndex) => {
    if (!Array.isArray(state) || state.length !== RING_LENGTH) {
      throw new Error(`${label}[${stateIndex}] must contain exactly ${RING_LENGTH} HSV slots`);
    }
    const copied = state.map((channel, slotIndex) => {
      if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
        throw new Error(`${label}[${stateIndex}][${slotIndex}] must be an {h,s,v} object`);
      }
      return validatePaletteChannel(channel, `${label}[${stateIndex}][${slotIndex}]`);
    });
    const pair = palettes[stateIndex];
    if (pair && typeof pair === 'object' && !Array.isArray(pair)) {
      if (!sameHsv(copied[0], asFullHsv(pair.c1)) || !sameHsv(copied[1], asFullHsv(pair.c2))) {
        throw new Error(
          `${label}[${stateIndex}] slots 0/1 must exactly match palettes[${stateIndex}].c1/c2`,
        );
      }
    }
    return copied;
  });
}

/**
 * ColorAutopilot — cycles a SET of color palettes on a self-rescheduling
 * timer, applying one palette every `delay_s` seconds. This is the palette
 * analogue of the pattern Autopilot (lib/autopilot.js): same generation-guard
 * timer model, but it advances a palette (CPC colour pair) instead of a deck
 * pattern. The two run in PARALLEL and never touch each other's state — color
 * cycling does not change the running pattern.
 *
 * Timer model (mirrors Autopilot, docs/39):
 *   wait delay_s  →  apply next palette (AWAIT the crossfade)  →  repeat
 * Exactly the pattern Autopilot's await-swap-then-reschedule model: the apply
 * — including a transitionMs crossfade — completes BEFORE the next delay_s
 * wait is armed, so the transition is ADDITIVE to the hold. delay_s=5 +
 * transitionMs=1000 is a 6 s cycle (5 s hold + 1 s fade); the fade never eats
 * into the hold (operator ruling 2026-07-03; locked by the additive-scheduling
 * tests).
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
 *   { active: boolean, palettes: (string | {c1,c2})[] (>=1 entry),
 *     delay_s: number >= 0, shuffle?: boolean (default false),
 *     transitionMs?: number >= 0 (default 0) }
 * A palettes entry is EITHER a known library id OR an INLINE colour pair
 * `{ c1, c2 }` — the COLORS window's PALETTE TURNS chooses five
 * ad-hoc colours that have no library id (docs/53 §5.3, engine slice E1). Each
 * channel is a hue number in 0..1 OR a full `{h,s,v}` object (D2, docs/55 §1).
 * `delay_s: 0` is CONTINUOUS — no hold, fades run back to back — and requires
 * `transitionMs >= 100` so it can never degenerate into a hard-cut spin loop. The
 * injected resolver handles both forms and returns the same params shape, so
 * hard cut, crossfade tween, seedCurrentParams and the timeline path are
 * untouched. YAML/JSON persist an inline entry verbatim.
 */
export class ColorAutopilot {
  /**
   * @param {(palette: string|{c1:number,c2:number}) => (void|Promise)} applyPaletteFn
   *   — resolve + apply a palette ENTRY: a library id or an inline {c1,c2} hue
   *   pair (throws on an unknown id; may be async). Used for HARD
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
   *   - getSignalFn(key) => number : read one CPC signal. REQUIRED for
   *     `mode: 'followNote'` (the daemon reads `audioNote` / `audioNoteHue`).
   *   - onNoteChange() => void : fired when the COMMITTED note changes under
   *     follow-note mode (the server re-broadcasts so the card's note letter is
   *     live rather than a method-hold behind).
   *   - subscribeSignalsFn(fn) => unsubscribe : subscribe to CPC mutations.
   *     REQUIRED for `mode: 'followNote'`. Both are injected by api_server from
   *     `paramCenter`; tests inject a fake CPC.
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
    this._transitionReadback = new ColorAutopilotTransition({
      now: this._now,
      publish: hooks.onTransition,
      resolveScope: hooks.resolveTransitionScopeFn,
    });
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
    // Fired when the COMMITTED note changes under follow-note mode, so the
    // server can re-broadcast the state line's note letter. Separate from
    // `onSchedule` because the two answer different questions ("the cadence
    // moved" vs "the music moved") and a surface may want only one.
    this.onNoteChange = typeof hooks.onNoteChange === 'function' ? hooks.onNoteChange : null;
    // Injected-clock ms when the next palette switch fires (null when inactive).
    this._nextSwapAtMs = null;
    // Sequential cursor — index of the LAST applied entry in the rotation list:
    // `state.palettes` in palettes mode, `state.followNote.schemes` in
    // follow-note mode. ONE cursor because there is ONE rotation running; -1
    // means "nothing applied yet" and the first tick applies index 0.
    this._cursor = -1;

    // ── FOLLOW NOTE wiring (docs/59 §4.2) ─────────────────────────────────
    // The note loop is a SUBSCRIPTION, not a poll: zero work while the note
    // holds, no third clock in the engine, and it releases on stop/deactivate
    // (the `audio_reactive_profile.js` `_unsub` lifecycle, verbatim).
    this._getSignal = typeof hooks.getSignalFn === 'function' ? hooks.getSignalFn : null;
    this._subscribeSignals = typeof hooks.subscribeSignalsFn === 'function' ? hooks.subscribeSignalsFn : null;
    this._noteUnsub = null;
    // The note pair AS LAST READ. The subscriber fires at hop rate and the
    // compare is two numbers, so an unchanged note costs two reads and a
    // branch — this is what makes subscribing cheaper than polling rather than
    // just differently shaped.
    this._notePc = null;
    this._noteHue = null;
    // Injected-clock ms when the CURRENT hold was armed. The re-arm in
    // `patchState` measures from HERE, not from the tick, because that is what
    // "phase-preserving" means: the elapsed portion of the hold survives the
    // retune. With a hard-cut config (no fade) the two instants coincide, which
    // is the identity docs/59 §5.3 states.
    this._holdStartedAtMs = null;
    // Injected-clock ms when the last tick FIRED (docs/59 §5.1's `_lastTickAtMs`).
    this._lastTickAtMs = null;
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

  /* RUNTIME STATE IS NOT CONFIG — the same split autopilot.js already makes.

     `colorAutopilot.active` flips on every arm, disarm, deadman fire and
     crash-boot revert, and saveConfig() used to yaml.dump the WHOLE document
     back over config.yaml, which is tracked and comment-bearing. So ordinary
     show operation produced git diffs on the show server and quietly rewrote
     unrelated lines. MEASURED this session: one disarm left config.yaml with
     `colorAutopilot.active: false -> true` AND `triggerMask: 0x07 -> 7` — the
     hex literal destroyed as collateral by the round-trip, exactly the damage
     autopilot.js's RUNTIME_FILE note describes.

     Config is what the operator chose; runtime state is what the show is doing.
     Persistence across restarts is unchanged — loadConfig overlays the runtime
     file on top of the config. Derived from configFile so a test pointing at a
     scratch config automatically gets a scratch runtime file too. */
  get runtimeFile() {
    return String(this.configFile).replace(/\.ya?ml$/i, '') + '.color_autopilot_runtime.yaml';
  }

  loadConfig() {
    let cfg = {};
    if (fs.existsSync(this.configFile)) {
      cfg = yaml.load(fs.readFileSync(this.configFile, 'utf8')) || {};
    }
    try {
      if (fs.existsSync(this.runtimeFile)) {
        const rt = yaml.load(fs.readFileSync(this.runtimeFile, 'utf8')) || {};
        if (rt && rt.colorAutopilot && typeof rt.colorAutopilot === 'object') {
          cfg.colorAutopilot = { ...(cfg.colorAutopilot || {}), ...rt.colorAutopilot };
        }
      }
    } catch (e) { /* a corrupt runtime file must not stop the show booting */ }
    return cfg;
  }

  saveConfig() {
    // ONLY the colorAutopilot block, and ONLY to the runtime file. config.yaml
    // is never written here — see the runtimeFile note above.
    fs.writeFileSync(this.runtimeFile,
      yaml.dump({ colorAutopilot: this.config.colorAutopilot || {} }));
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
    // ── MODE (docs/59 §4.1) ────────────────────────────────────────────────
    // Absent ≡ 'palettes'. Anything that is neither of the two known modes is
    // refused by NAME rather than silently treated as the legacy one: a typo'd
    // mode that quietly ran the palette cycle would look exactly like a
    // follow-note config that isn't following.
    if (obj.mode !== undefined && !COLOR_AUTOPILOT_MODES.includes(obj.mode)) {
      throw new Error(
        `colorAutopilot.mode must be one of ${COLOR_AUTOPILOT_MODES.join(', ')} (or absent, meaning palettes), `
        + `got ${JSON.stringify(obj.mode)}`);
    }
    if (colorAutopilotMode(obj) === 'followNote') {
      // EXACTLY ONE MODE'S FIELDS. A config carrying both halves would let the
      // two disagree about what is running — and worse, would round-trip
      // through the broadcast as if both were live. The refusal names the
      // offending field so the fix is one deletion.
      for (const forbidden of ['palettes', 'livePalettes', 'delay_s', 'transitionMs', 'shuffle']) {
        if (obj[forbidden] !== undefined) {
          throw new Error(
            `colorAutopilot.mode 'followNote' does not take '${forbidden}' — that is a palettes-mode field. `
            + 'Exactly one mode\'s fields may be present.');
        }
      }
      if (obj.followNote === undefined) {
        throw new Error("colorAutopilot.mode 'followNote' requires a followNote block { schemes, methodHoldS, methodFadeS, noteFadeMs, sel }");
      }
      return { active: obj.active, mode: 'followNote', followNote: validateFollowNote(obj.followNote) };
    }
    // PALETTES mode. A `followNote` block here is ALLOWED and INERT — carried,
    // never read to make a decision — so toggling the mode back and forth
    // round-trips the operator's follow-note tuning instead of erasing it. It
    // is still validated: storing a block that would be refused on the way back
    // in is how you get a mode toggle that fails a week later.
    let followNote;
    if (obj.followNote !== undefined) followNote = validateFollowNote(obj.followNote);
    if (!Array.isArray(obj.palettes) || obj.palettes.length === 0) {
      throw new Error('colorAutopilot.palettes must be a non-empty array of palette ids');
    }
    // E1 (docs/53 §5.3): an entry is EITHER a known library id OR an inline
    // {c1,c2} pair (the COLORS window's PALETTE TURNS posts five ad-hoc
    // pairs — they have no library id and inventing one would be a lie). Both
    // forms resolve to the same CPC params downstream, so nothing else in the
    // daemon changes. Inline entries are COPIED, never aliased to the caller's
    // object: the daemon's state must not mutate under a wire object someone
    // else still holds.
    // D2 (docs/55 §1): each CHANNEL of an inline pair is EITHER a hue number
    // (resolves s=1,v=1 — the existing wire, byte-unchanged) OR a full
    // {h,s,v} object. The CPC palette params were always full HSV; the
    // hue-only pin was resolver POLICY, and it made the Live Touch MASTER/HUE
    // generators (which vary v) inexpressible.
    const palettes = obj.palettes.map((entry, i) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return {
          c1: validatePaletteChannel(entry.c1, `colorAutopilot.palettes[${i}].c1`),
          c2: validatePaletteChannel(entry.c2, `colorAutopilot.palettes[${i}].c2`),
        };
      }
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new Error(
          `colorAutopilot.palettes[${i}] must be a non-empty string or a {c1,c2} pair, got ${JSON.stringify(entry)}`);
      }
      if (knownIds && !knownIds.has(entry)) {
        throw new Error(`colorAutopilot.palettes[${i}] "${entry}" is not a known palette id`);
      }
      return entry;
    });
    const livePalettes = obj.livePalettes === undefined
      ? undefined
      : validateLivePalettes(obj.livePalettes, palettes);
    // delay_s >= 0 (docs/55 §3.1). 0 means CONTINUOUS: no hold at all, the
    // fades run back to back. Negative / NaN / non-number is an authoring
    // error → throw loud. The zero+zero spin-loop case is refused below, once
    // transitionMs is known.
    if (typeof obj.delay_s !== 'number' || !Number.isFinite(obj.delay_s) || obj.delay_s < 0) {
      throw new Error(`colorAutopilot.delay_s must be a number >= 0, got ${JSON.stringify(obj.delay_s)}`);
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
    // ZERO HOLD + ZERO FADE would be a hard-cut spin loop hammering the CPC at
    // timer resolution. That config must be UNREPRESENTABLE, not clamped
    // (codex P0: no silent correction) — so continuous mode requires a real
    // fade to occupy the cycle.
    if (obj.delay_s === 0 && transitionMs < MIN_CONTINUOUS_TRANSITION_MS) {
      throw new Error(
        `colorAutopilot.delay_s 0 (continuous) requires transitionMs >= ${MIN_CONTINUOUS_TRANSITION_MS}, `
        + `got ${JSON.stringify(obj.transitionMs)}`);
    }
    const out = { active: obj.active, mode: 'palettes', palettes, delay_s: obj.delay_s, shuffle, transitionMs };
    if (livePalettes) out.livePalettes = livePalettes;
    if (followNote) out.followNote = followNote;
    return out;
  }

  /**
   * MERGE a sparse REST body over the live config into a full wire object, the
   * way `POST /deck/color-autopilot` has always done — but MODE-AWARE.
   *
   * The old `{ ...state, ...body }` merge cannot survive a mode discriminator:
   * the live state always carries `palettes`/`delay_s`, so a body saying
   * `mode:'followNote'` would merge into a config carrying BOTH modes' fields
   * and be refused by the rule above — the operator's START button would 400
   * on a perfectly good request.
   *
   * So the carry-over is scoped to the TARGET mode. A mode change is a
   * takeover (docs/59 §6): it inherits nothing from the mode it replaces
   * except `active` and the INERT block of the other mode, which rides along
   * precisely so a there-and-back toggle does not erase the operator's tuning.
   * A nested `followNote` in the body merges over the carried block rather
   * than replacing it, so a one-field pill tap does not have to re-send the
   * whole cycle configuration.
   *
   * WHEN THE BODY DOES NOT NAME A MODE, the mode is inferred from the FIELDS
   * the body carries, not from what happens to be running. This is not a
   * convenience — it is the back-compat contract. Every caller written before
   * this feature POSTs `{active, palettes, delay_s, …}` with no `mode` at all
   * (the timeline cue path, older CaptainPad builds, hand-rolled scripts), and
   * inheriting the live mode meant that once FOLLOW NOTE had been used ONCE,
   * every one of those posts merged into a config carrying both modes' fields
   * and came back 400. Caught by `color_window_engine_api` against a rig whose
   * persisted runtime block had been left in follow-note mode — i.e. exactly
   * the state the operator's engine is in after trying the feature.
   *
   * A body naming a palettes-mode field IS a palettes-mode config; a body
   * carrying a `followNote` block IS a follow-note one. A body carrying BOTH is
   * genuinely ambiguous, so it keeps the live mode and lets `validate` refuse it
   * by name — the one thing that must never happen is quietly picking one.
   */
  /**
   * Which mode does a `mode`-less body mean? Decided by the FIELDS it carries,
   * falling back to the live mode only when the body says nothing either way
   * (e.g. a bare `{ active: false }` stop, which must not change the mode).
   */
  static inferMode(patch, current) {
    const saysPalettes = ['palettes', 'livePalettes', 'delay_s', 'transitionMs', 'shuffle']
      .some((k) => patch[k] !== undefined);
    const saysFollow = patch.followNote !== undefined;
    if (saysPalettes && !saysFollow) return 'palettes';
    if (saysFollow && !saysPalettes) return 'followNote';
    return colorAutopilotMode(current);
  }

  static mergeWire(current, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('colorAutopilot body must be an object');
    }
    const cur = current && typeof current === 'object' ? current : {};
    const mode = patch.mode !== undefined ? patch.mode : ColorAutopilot.inferMode(patch, cur);
    const base = { active: cur.active, mode };
    if (mode === 'followNote') {
      if (cur.followNote !== undefined) base.followNote = cur.followNote;
    } else {
      base.palettes = cur.palettes;
      if (cur.livePalettes !== undefined) base.livePalettes = cur.livePalettes;
      base.delay_s = cur.delay_s;
      base.shuffle = cur.shuffle;
      base.transitionMs = cur.transitionMs;
      if (cur.followNote !== undefined) base.followNote = cur.followNote;
    }
    const out = { ...base, ...patch };
    if (patch.followNote && typeof patch.followNote === 'object' && !Array.isArray(patch.followNote)
      && base.followNote && typeof base.followNote === 'object') {
      out.followNote = { ...base.followNote, ...patch.followNote };
    }
    return out;
  }

  /**
   * Replace the colorAutopilot config (already-validated shape), persist it,
   * and (re)start the cycle. Bumps generation FIRST so any in-flight tick reads
   * the new gen and bails before doing work. Resets the sequential cursor so a
   * config change starts the new palette set from the top. Any in-flight
   * crossfade tween is cancelled (reconfig is a clean break).
   */
  setState(newState) {
    if (colorAutopilotMode(newState) === 'followNote') {
      const fn = newState.followNote;
      this.config.colorAutopilot = {
        active: newState.active,
        mode: 'followNote',
        followNote: { ...fn, schemes: [...fn.schemes], sel: [...fn.sel] },
      };
    } else {
      this.config.colorAutopilot = {
        active: newState.active,
        mode: 'palettes',
        palettes: [...newState.palettes],
        delay_s: newState.delay_s,
        shuffle: newState.shuffle !== undefined ? newState.shuffle : false,
        transitionMs: newState.transitionMs !== undefined ? newState.transitionMs : DEFAULT_TRANSITION_MS,
      };
      if (newState.livePalettes !== undefined) {
        this.config.colorAutopilot.livePalettes = newState.livePalettes.map(
          state => state.map(channel => ({ ...channel })),
        );
      }
      // The INERT follow-note block rides along so a mode toggle round-trips
      // the operator's cycle tuning (docs/59 §4.1). Nothing ever READS it while
      // the mode is palettes — that is what makes it stored config rather than
      // a fallback.
      if (newState.followNote !== undefined) {
        this.config.colorAutopilot.followNote = {
          ...newState.followNote,
          schemes: [...newState.followNote.schemes],
          sel: [...newState.followNote.sel],
        };
      }
    }
    this._cursor = -1;
    this._cancelTween();
    this.saveConfig();
    this.generation++;
    this._syncNoteSubscription();
    this._scheduleNext();
    this._primeFollowNote();
  }

  start() {
    this._syncNoteSubscription();
    this._scheduleNext();
    this._primeFollowNote();
  }

  // ── FOLLOW NOTE (docs/59 §4.2) ─────────────────────────────────────────────

  /** Which mode is the daemon running? Derived from state, never stored twice. */
  get mode() {
    return colorAutopilotMode(this.state);
  }

  /** The generator currently on the rig (null outside follow-note mode). Derived
   *  from the cursor + the configured subset, with the scheme-tap override
   *  (`followNote.method`) taking precedence until the next advance. */
  get currentScheme() {
    if (this.mode !== 'followNote') return null;
    const fn = this.state.followNote;
    if (!fn || !Array.isArray(fn.schemes) || fn.schemes.length === 0) return null;
    if (this._cursor < 0) return fn.method || fn.schemes[0];
    return fn.schemes[this._cursor % fn.schemes.length];
  }

  /** The committed pitch class the daemon last acted on (null before the first
   *  read / outside follow-note mode). */
  get notePc() { return this.mode === 'followNote' ? this._notePc : null; }
  /** The note hue the daemon last acted on. */
  get noteHue() { return this.mode === 'followNote' ? this._noteHue : null; }
  /** Injected-clock ms of the next METHOD advance (null outside follow-note). */
  get nextMethodAtMs() { return this.mode === 'followNote' ? this.nextSwapAtMs : null; }

  /**
   * Take or release the CPC subscription so it exactly matches "follow-note is
   * running". Called on every state change and on start/stop, so there is one
   * rule and no path that can leak a subscriber past a deactivate.
   *
   * A follow-note config with no hooks THROWS (codex P0): the mode's whole
   * premise is that the engine has the note, and a daemon that quietly ran the
   * method cycle on a frozen hue would look exactly like a working feature with
   * a dead companion.
   */
  _syncNoteSubscription() {
    const wantNote = this.mode === 'followNote' && this.state.active;
    if (!wantNote) {
      if (this._noteUnsub) {
        try { this._noteUnsub(); } catch { /* already gone */ }
        this._noteUnsub = null;
      }
      return;
    }
    if (!this._getSignal || !this._subscribeSignals || !this.applyParams) {
      throw new Error(
        "ColorAutopilot: mode 'followNote' requires the getSignalFn, subscribeSignalsFn and "
        + 'applyParamsFn hooks — the note loop reads audioNote/audioNoteHue off the CPC and writes '
        + 'the palette params directly.');
    }
    if (this._noteUnsub) return;
    this._noteUnsub = this._subscribeSignals(() => this._onSignalChange());
  }

  /**
   * One CPC mutation event. The subscriber fires at hop rate, so the FIRST
   * thing it does is a two-number compare and a bail: while the note holds
   * (which is most of the time, by design — the estimator commits changes only
   * after consensus + hysteresis) this costs two reads and a branch, and writes
   * nothing at all.
   *
   * The new pair is recorded BEFORE the apply. That ordering is what bounds a
   * broken feed to ONE loud log per distinct bad value instead of one per hop:
   * a NaN hue throws out of `generateScheme`, paramCenter logs the subscriber
   * throw, and the next identical NaN is bailed on by the compare.
   */
  _onSignalChange() {
    if (this.mode !== 'followNote' || !this.state.active) return;
    const pc = this._getSignal(NOTE_PC_KEY);
    const hue = this._getSignal(NOTE_HUE_KEY);
    if (pc === this._notePc && hue === this._noteHue) return;
    this._notePc = pc;
    this._noteHue = hue;
    // TELL THE SURFACES. The card's state line ("NOTE IS DRIVING — E …") is
    // derived from the broadcast, so without this the note letter would only
    // refresh when something ELSE re-broadcast — i.e. at the next method
    // advance, up to `methodHoldS` (60 s by default) late. Measured on the
    // offline walk: the rig had moved to G while the card still said E.
    //
    // This is NOT the flood the crossfade frames were: it fires on a CHANGE of
    // the COMMITTED pitch class only, which the estimator gates behind
    // mode-window consensus + hold hysteresis specifically so hue does not
    // strobe. The hop-rate republishes bailed out three lines above.
    if (this.onNoteChange) this.onNoteChange();
    const fn = this.state.followNote;
    const gen = this.generation;
    // A note change RETARGETS: `_runTween` cancels the in-flight fade and ramps
    // from `_currentParams` — wherever the fade actually got to — so a melodic
    // run degrades into a continuous glide rather than a queue of jumps.
    this._applyFollowNoteTarget(Number(fn.noteFadeMs), gen).catch((e) => {
      console.warn('[ColorAutopilot] follow-note apply failed:', e && e.message ? e.message : e);
    });
  }

  /**
   * Derive the ring for the CURRENT method at the CURRENT note hue, pick the
   * two `sel` slots, and move the rig there over `durationMs` (0 = snap).
   *
   * Every write goes through `applyParams` — the same
   * `paramCenter.set(k, v, 'colorAutopilot')` path every palette tick uses — so
   * attribution never changes and "a colour rotation is driving" stays
   * literally true while following.
   */
  async _applyFollowNoteTarget(durationMs, gen) {
    if (gen !== this.generation) return;
    const fn = this.state.followNote;
    const scheme = this.currentScheme;
    if (!fn || !scheme) return;
    const ring = generateScheme(scheme, this._noteHue);
    const target = {
      colorPalette1: { ...ring[fn.sel[0]] },
      colorPalette2: { ...ring[fn.sel[1]] },
    };
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    const from = this._currentParams;
    // No fade, or nothing to fade FROM (the very first apply after a start with
    // no seeded params) → land on the target directly. Not a fallback: a ramp
    // needs two endpoints and there is only one.
    if (ms === 0 || !from) {
      this._cancelTween();
      this.applyParams(target);
      this._currentParams = target;
      return;
    }
    await this._runTween(from, target, ms, gen);
  }

  /**
   * Put the FIRST ring on the rig the moment follow-note goes active, over the
   * note-slew duration.
   *
   * Without this a START would leave the rig on whatever the last writer left
   * until either the first note change or the first method advance — up to
   * `methodHoldS` (60 s by default) of a card that says "NOTE IS DRIVING" while
   * nothing is. Fire-and-forget on purpose: the tween schedules its own frames
   * and `setState` must stay synchronous for its callers.
   */
  _primeFollowNote() {
    if (this.mode !== 'followNote' || !this.state.active) return;
    const fn = this.state.followNote;
    // The prime CONSUMES a cycle position: without this the cursor would still
    // be -1 when the first method timer fires, `_pickIndex` would hand back 0
    // again, and the first "advance" would visibly re-apply the method already
    // on the rig — a three-second crossfade to itself. A pending scheme-tap
    // override keeps the cursor at -1 on purpose: that IS what makes
    // `currentScheme` read the override rather than the subset.
    this._cursor = fn.method !== undefined ? -1 : 0;
    this._notePc = this._getSignal(NOTE_PC_KEY);
    this._noteHue = this._getSignal(NOTE_HUE_KEY);
    this._applyFollowNoteTarget(Number(fn.noteFadeMs), this.generation).catch((e) => {
      console.warn('[ColorAutopilot] follow-note start failed:', e && e.message ? e.message : e);
    });
  }

  /**
   * Seed the crossfade START point with an already-resolved params object (the
   * shape resolvePaletteFn returns: { colorPalette1:{h,s,v}, colorPalette2:{h,s,v} }).
   * Used by the timeline before a cue-start immediate apply so the FIRST palette
   * fades FROM the color that's actually on screen (the live CPC palette) rather
   * than from a stale/null start — which would otherwise jump then fade. A no-op
   * degrades to a hard snap on the first apply (from === null).
   */
  seedCurrentParams(params) {
    this._currentParams = params || null;
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
    if (!st.active || !this._rotationLength()) {
      this._nextSwapAtMs = null;
      this._holdStartedAtMs = null;
      if (this.onSchedule) this.onSchedule();
      return;
    }
    const delayMs = this._holdMs();
    const gen = this.generation;
    this._holdStartedAtMs = this._now();
    this._nextSwapAtMs = this._holdStartedAtMs + delayMs;
    this._armTimer(delayMs, gen);
    if (this.onSchedule) this.onSchedule();
  }

  /** How many entries the running rotation cycles through — palettes, or the
   *  follow-note method subset. 0 means "nothing to rotate", which parks the
   *  timer instead of scheduling an empty tick. */
  _rotationLength() {
    const st = this.state;
    if (colorAutopilotMode(st) === 'followNote') {
      const fn = st.followNote;
      return fn && Array.isArray(fn.schemes) ? fn.schemes.length : 0;
    }
    return Array.isArray(st.palettes) ? st.palettes.length : 0;
  }

  /** The HOLD, in ms, for whichever mode is running. */
  _holdMs() {
    const st = this.state;
    if (colorAutopilotMode(st) === 'followNote') {
      // Already validated to a finite >= 0 by `validateFollowNote`; the Number()
      // is for a hand-edited runtime file, which must not turn a bad value into
      // a plausible one — hence the explicit default only for absent/unparseable.
      const raw = Number(st.followNote.methodHoldS);
      return (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_METHOD_HOLD_S) * 1000;
    }
    // delay_s 0 is CONTINUOUS and must be HONORED (docs/55 §3.1). The old
    // `> 0 ? … : DEFAULT` test silently turned a continuous crossfade into a
    // 30 s hold — a hidden fallback (codex P0). The default now covers only the
    // truly-absent / unparseable case, which is a legacy config with no
    // delay_s at all, never an operator's deliberate 0.
    const rawDelayS = Number(st.delay_s);
    return (Number.isFinite(rawDelayS) && rawDelayS >= 0 ? rawDelayS : DEFAULT_DELAY_S) * 1000;
  }

  /** Arm the cycle timer for `delayMs` under generation `gen`. Split out of
   *  `_scheduleNext` so the phase-preserving re-arm in `patchState` uses the
   *  IDENTICAL firing path — including the error handling — rather than a
   *  second, subtly different copy of it. */
  _armTimer(delayMs, gen) {
    this.cycleTimer = setTimeout(() => {
      this._runTick(gen).catch((e) => {
        console.warn('[ColorAutopilot] tick failed:', e && e.message ? e.message : e);
        // Mirror the pattern Autopilot's cycle-continuation: a throwing apply
        // is logged LOUD but must not kill the daemon — re-arm the cycle so the
        // next palette still lands (Autopilot._runTick catches its swap error
        // and reschedules the same way). Guarded on gen + active so a reconfig
        // or pause that raced the failure doesn't double-schedule. A manual
        // triggerNext() still REJECTS (codex P0 — no silent skip for callers).
        if (gen === this.generation && this.state.active) this._scheduleNext();
      });
    }, delayMs);
    // Don't keep the event loop alive solely for the color cycle (mirrors the
    // bump-sweep timer): the engine stays up via its HTTP server, and tests must
    // not hang on a pending palette tick.
    if (typeof this.cycleTimer.unref === 'function') this.cycleTimer.unref();
    // NOTE: `onSchedule` is fired by the CALLER, not here — `_scheduleNext` and
    // `_rearmHold` both broadcast exactly once after they have finished setting
    // `_nextSwapAtMs`, so the countdown a listener reads is never the old one.
  }

  /** Injected-clock ms when the next palette switch fires, or null when inactive. */
  get nextSwapAtMs() {
    return this.state.active && typeof this._nextSwapAtMs === 'number' ? this._nextSwapAtMs : null;
  }

  get transition() {
    return this._transitionReadback.state;
  }

  // Stop the cycle (clears the pending timer + any in-flight crossfade tween).
  // Idempotent.
  stop() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    this._cancelTween();
    // Release the CPC subscription too (docs/59 §4.2). A stopped daemon that
    // kept listening would keep writing the palette on every note change — the
    // exact "STOP did nothing" failure the single-writer gate exists to prevent.
    if (this._noteUnsub) {
      try { this._noteUnsub(); } catch { /* already gone */ }
      this._noteUnsub = null;
    }
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
    if (!st.active) return;
    // Recorded on FIRE, per docs/59 §5.1 — the phase-preserving re-arm reads it.
    this._lastTickAtMs = this._now();

    if (colorAutopilotMode(st) === 'followNote') {
      // METHOD ADVANCE. The subset and the durations are read FRESH here, at
      // fire time, which is exactly why `patchState` never needs to touch the
      // pending tick: a subset swapped mid-hold takes effect on this line.
      const fn = st.followNote;
      if (!Array.isArray(fn.schemes) || fn.schemes.length === 0) return;
      this._cursor = this._pickIndex(fn.schemes.length, fn.shuffle);
      // A scheme-tap override lives only until the cycle moves on: the advance
      // CONSUMES it, so "cycle continues from here" is literally true — and the
      // consumption is persisted, or a crash-boot would resurrect an override
      // the operator watched the cycle move past.
      if (fn.method !== undefined) {
        const { method, ...rest } = fn;
        this.config.colorAutopilot = { ...st, followNote: rest };
        this.saveConfig();
      }
      // AWAITED, so hold and fade stay ADDITIVE — the same scheduling contract
      // the palette cycle locks (operator ruling 2026-07-03).
      await this._applyFollowNoteTarget(Number(fn.methodFadeS) * 1000, scheduledGen);
    } else {
      if (!Array.isArray(st.palettes) || st.palettes.length === 0) return;
      const id = this._pickNext(st);
      await this._applyPalette(id, st, scheduledGen);
    }

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
    const livePalette = Array.isArray(st.livePalettes) ? st.livePalettes[this._cursor] : undefined;
    const transitionMs = Number(st.transitionMs) > 0 ? Number(st.transitionMs) : 0;
    const canCrossfade = transitionMs > 0 && this.resolvePalette && this.applyParams;

    if (!canCrossfade) {
      // Hard cut: write the palette directly. Keep _currentParams in sync (when
      // we can resolve) so a LATER crossfade ramps from the right start point.
      const target = this.resolvePalette ? this.resolvePalette(id, livePalette) : null;
      const transitionId = target
        ? this._transitionReadback.begin(this._currentParams, target, 0)
        : null;
      const ret = this.applyPalette(id, livePalette);
      if (ret && typeof ret.then === 'function') await ret;
      if (target) {
        this._currentParams = target;
        this._transitionReadback.settle(transitionId, target);
      }
      return;
    }

    // Resolve target params loudly (unknown id throws — codex P0).
    const target = this.resolvePalette(id, livePalette);
    const from = this._currentParams;
    // No known start point yet → snap to target (the first applied palette has
    // nothing to fade FROM). Subsequent switches ramp.
    if (!from) {
      const transitionId = this._transitionReadback.begin(null, target, 0);
      this.applyParams(target);
      this._currentParams = target;
      this._transitionReadback.settle(transitionId, target);
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
    const transitionId = this._transitionReadback.begin(from, to, durationMs);
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
        this._transitionReadback.update(transitionId, frame, t);
        if (t >= 1) {
          // Land exactly on target to avoid float residue.
          this.applyParams(to);
          this._currentParams = to;
          this._transitionReadback.settle(transitionId, to);
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
    this._transitionReadback.cancel(this._currentParams);
  }

  // Pick the next palette id: sequential (advance the cursor with wrap) or, when
  // shuffle is on, a random pick that avoids repeating the immediately-previous
  // palette when the set has more than one entry.
  _pickNext(st) {
    this._cursor = this._pickIndex(st.palettes.length, st.shuffle);
    return st.palettes[this._cursor];
  }

  /** The next cursor position over a list of `length` entries: sequential with
   *  wrap, or — under shuffle — a random pick that avoids repeating the
   *  immediately-previous one. Shared by BOTH rotations (palette ids and
   *  follow-note methods) so "shuffle never repeats" is one rule, not two. */
  _pickIndex(length, shuffle) {
    if (shuffle && length > 1) {
      let idx;
      do {
        idx = Math.floor(Math.random() * length);
      } while (idx === this._cursor);
      return idx;
    }
    return (this._cursor + 1) % length;
  }

  // Back-compat / test shim: manually advance one step (no scheduling).
  triggerNext() {
    return this._runTick(this.generation);
  }

  // ── LIVE RETUNE (docs/59 §5) ───────────────────────────────────────────────

  /**
   * RETUNE A RUNNING ROTATION IN PLACE — the operator's follow-up order:
   * *"changing of the parameters for those existing ones too doesn't need a
   * full stop and start again"*.
   *
   * THE LOAD-BEARING RULE: `patchState` NEVER bumps `generation` and NEVER
   * cancels the tween. That is the whole mechanism, and it is safe rather than
   * scary because the reset behaviour of `setState` was never in the TICK —
   * the tick reads `this.state`, the ring and the durations FRESH at fire time
   * — it was in the generation bump and the cursor reset, which a patch simply
   * does not do. So the pending tick still fires, on its original schedule,
   * and does the new thing.
   *
   * Semantics, per field (docs/59 §5.1):
   *   delay_s / followNote.methodHoldS  applies NOW, phase-preserving (re-arm)
   *   transitionMs / methodFadeS        from the NEXT fade (in-flight one lands)
   *   noteFadeMs                        from the next note change
   *   palettes / followNote.schemes     from the next transition; cursor kept
   *   shuffle                           from the next pick
   *   followNote.sel                    NOW — a pair re-selection is a colour
   *                                     choice this instant, so it retweens
   *   followNote.method                 NOW — the scheme-tap override
   *   active / mode                     REFUSED (start/stop and mode changes
   *                                     are takeovers; they stay on setState)
   *
   * Every supplied field is validated by the SAME validators `validate()` uses,
   * throw-style. Returns the new state.
   */
  patchState(sparse, knownIds) {
    if (!sparse || typeof sparse !== 'object' || Array.isArray(sparse)) {
      throw new Error('colorAutopilot patch must be an object of the fields to change');
    }
    for (const takeover of ['active', 'mode']) {
      if (sparse[takeover] !== undefined) {
        throw new Error(
          `colorAutopilot patch cannot change '${takeover}' — starting, stopping and switching mode are `
          + 'TAKEOVERS and must be a full POST, so the rotation gets a clean break instead of a half-retune.');
      }
    }
    const st = this.state;
    const mode = colorAutopilotMode(st);
    const next = { ...st };
    let rearm = false;
    let retweenMs = null;

    // ── palettes-mode fields ──────────────────────────────────────────────
    const palettesFields = ['palettes', 'livePalettes', 'delay_s', 'transitionMs', 'shuffle'];
    for (const f of palettesFields) {
      if (sparse[f] !== undefined && mode !== 'palettes') {
        throw new Error(
          `colorAutopilot patch '${f}' is a palettes-mode field, but the daemon is running mode '${mode}'.`);
      }
    }
    if (sparse.palettes !== undefined || sparse.livePalettes !== undefined) {
      if ((sparse.palettes === undefined) !== (sparse.livePalettes === undefined)
          && (next.livePalettes !== undefined || sparse.livePalettes !== undefined)) {
        throw new Error(
          'colorAutopilot patch must change palettes and livePalettes together so their states stay parallel',
        );
      }
      // Reuse the FULL validator so a restage cannot smuggle in a shape a start
      // would have refused. `active`/`delay_s` are supplied from the live state
      // purely so the shared validator has a complete object to check.
      const probe = ColorAutopilot.validate(
        { active: true, palettes: sparse.palettes, delay_s: next.delay_s, transitionMs: next.transitionMs },
        knownIds);
      next.palettes = probe.palettes;
      // The cursor is PRESERVED (clamped): a ring restage keeps its place in the
      // rotation, which is what makes cadence, fade AND phase survive a scheme
      // swap (docs/59 §5.2 — `_224`'s one-tap restage becomes this patch).
      if (this._cursor >= next.palettes.length) this._cursor = next.palettes.length - 1;
    }
    if (sparse.delay_s !== undefined) {
      next.delay_s = numberField(sparse.delay_s, 'colorAutopilot.delay_s', undefined, 0);
      rearm = true;
    }
    if (sparse.transitionMs !== undefined) {
      next.transitionMs = numberField(sparse.transitionMs, 'colorAutopilot.transitionMs', undefined, 0);
    }
    if (sparse.shuffle !== undefined) {
      if (typeof sparse.shuffle !== 'boolean') {
        throw new Error(`colorAutopilot.shuffle must be a boolean, got ${JSON.stringify(sparse.shuffle)}`);
      }
      next.shuffle = sparse.shuffle;
    }
    if (mode === 'palettes' && next.delay_s === 0 && Number(next.transitionMs) < MIN_CONTINUOUS_TRANSITION_MS) {
      // The spin-loop rule is checked against the MERGED pair, not the patched
      // field alone: retuning HOLD to CONT while the fade is still a hard cut
      // is exactly the config a full POST refuses, and a patch must not be a
      // side door into it.
      throw new Error(
        `colorAutopilot.delay_s 0 (continuous) requires transitionMs >= ${MIN_CONTINUOUS_TRANSITION_MS}, `
        + `the live transitionMs is ${JSON.stringify(next.transitionMs)}`);
    }

    // ── follow-note fields ────────────────────────────────────────────────
    if (sparse.followNote !== undefined) {
      if (mode !== 'followNote') {
        throw new Error(
          `colorAutopilot patch 'followNote' is a follow-note field, but the daemon is running mode '${mode}'.`);
      }
      const fn = sparse.followNote;
      if (!fn || typeof fn !== 'object' || Array.isArray(fn)) {
        throw new Error('colorAutopilot.followNote patch must be an object of the fields to change');
      }
      // Validate the MERGED block through the same door a start goes through,
      // so a patch can never leave a config a POST would refuse (the CONT
      // hold/fade spin-loop rule included, for free).
      const merged = validateFollowNote({ ...st.followNote, ...fn });
      next.followNote = merged;
      if (fn.methodHoldS !== undefined) rearm = true;
      // sel and method are IMMEDIATE — both are "show me this colour now".
      if (fn.sel !== undefined) retweenMs = Number(merged.noteFadeMs);
      if (fn.method !== undefined) {
        // A tapped method takes the METHOD fade, not the note slew: it is a
        // method change that happens to be operator-initiated rather than
        // timer-initiated, and it should look identical on the rig.
        retweenMs = Number(merged.methodFadeS) * 1000;
        // The cursor is dropped to -1 so `currentScheme` reads the override;
        // the next advance then picks index 0 of the subset — "the cycle
        // continues from here".
        this._cursor = -1;
      } else if (Array.isArray(fn.schemes) && this._cursor >= merged.schemes.length) {
        this._cursor = merged.schemes.length - 1;
      }
    }

    this.config.colorAutopilot = next;
    this.saveConfig();
    // NO generation bump. NO _cancelTween. That is the feature.
    if (rearm) this._rearmHold();
    if (retweenMs !== null) {
      this._applyFollowNoteTarget(retweenMs, this.generation).catch((e) => {
        console.warn('[ColorAutopilot] follow-note retune apply failed:', e && e.message ? e.message : e);
      });
    }
    return this.state;
  }

  /**
   * Re-arm the PENDING hold to the new duration without losing the elapsed
   * portion of it. Measures from when the current hold STARTED, so a HOLD
   * 2 s → 10 s tapped three seconds in fires immediately (it is already past)
   * rather than waiting a fresh ten.
   *
   * A no-op when no timer is armed — which is precisely the mid-FADE case: the
   * `_scheduleNext` that runs after the fade lands reads the new hold fresh, so
   * there is nothing to correct and correcting anyway would double-arm.
   */
  _rearmHold() {
    if (!this.cycleTimer) return;
    const holdMs = this._holdMs();
    const base = typeof this._holdStartedAtMs === 'number' ? this._holdStartedAtMs : this._now();
    const at = base + holdMs;
    const remaining = Math.max(0, at - this._now());
    clearTimeout(this.cycleTimer);
    this.cycleTimer = null;
    this._nextSwapAtMs = at;
    this._armTimer(remaining, this.generation);
    if (this.onSchedule) this.onSchedule();
  }
}

/**
 * SHORTEST-ARC hue interpolation on the 0..1 colour wheel (D1, docs/55 §1).
 *
 * Plain linear interpolation sweeps a fade `h 0.9 → 0.1` the LONG way through
 * 0.5 (cyan) — ~78 % of the wheel instead of the 22 % the operator picked. The
 * engine already takes the short arc for MANUAL palette slews
 * (lib/color_transition.js, OKLCH); the autopilot fade was the one colour path
 * left going the long way round, and the wrap pair of every TURNS ring hit it.
 *
 * Pinned semantics (the reference table lives in BOTH this suite and
 * CaptainPad's `colors_window_logic.test.ts`, so engine and client can never
 * drift):
 *   lerpHue(0.9, 0.1, 0.5) === 0.0     (wraps forward through 1.0)
 *   lerpHue(0.1, 0.9, 0.5) === 0.0     (wraps backward through 0.0)
 *   lerpHue(0.2, 0.6, 0.5) === 0.4     (no wrap — plain midpoint)
 *   lerpHue(0.0, 0.5, 0.5) === 0.25    (exact-half tie resolves FORWARD)
 *   lerpHue(x,   x,   any) === x
 *   t <= 0 / t >= 1 return the EXACT endpoints (no float residue)
 * The tie at d = 0.5 is genuinely ambiguous — both arcs are the same length —
 * so it is decided once, here, deterministically, rather than left to the sign
 * of a subtraction.
 */
export function lerpHue(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  if (a === b) return a;
  // Wrap the signed delta into (-0.5, +0.5]: the tie at exactly 0.5 keeps the
  // POSITIVE (forward) arc.
  let d = b - a;
  d -= Math.floor(d);
  if (d > 0.5) d -= 1;
  const h = a + d * t;
  return ((h % 1) + 1) % 1;
}

/**
 * Is this a colour leaf — an `{h,s,v}` sub-object whose channels are actually
 * ON the unit colour wheel?
 *
 * The [0,1] RANGE CHECK is load-bearing, not defensive padding: `lerpHue` is
 * modular arithmetic on the unit wheel, so it is only MEANINGFUL for a hue in
 * [0,1]. Handed a value like `h: 100` (a degrees-scaled or otherwise
 * non-wheel number) the modulo would collapse the delta to zero and the fade
 * would silently stop moving. A sub-object that is not on the wheel is
 * therefore not a colour for interpolation purposes and keeps the plain linear
 * path — which is also byte-identical to the pre-D1 behavior. Every engine
 * palette path (resolveColorPaletteParams, ColorAutopilot.validate) emits
 * channels in [0,1], so real colours always take the short arc.
 */
function isColourShaped(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  for (const ch of ['h', 's', 'v']) {
    const n = o[ch];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return false;
  }
  return true;
}

/**
 * Linearly interpolate every numeric leaf of `to` from the matching leaf in
 * `from` by factor t in [0,1]. Params are shallow objects of either numbers or
 * small {h,s,v}-style sub-objects (the color-palette shape), so we recurse one
 * level into plain objects. A non-numeric / structurally-mismatched leaf snaps
 * to the target value (no interpolation defined). Pure — returns a fresh object.
 *
 * D1 EXCEPTION: when BOTH sides of a sub-object are colour-shaped, the `h`
 * channel takes the SHORTEST ARC (`lerpHue`) while `s` and `v` stay linear.
 * Every other leaf, and every non-colour object, is byte-identical to before.
 */
export function lerpParams(from, to, t) {
  const out = {};
  for (const k in to) {
    const a = from ? from[k] : undefined;
    const b = to[k];
    if (typeof b === 'number' && typeof a === 'number') {
      out[k] = a + (b - a) * t;
    } else if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) {
      const sub = lerpParams(a, b, t);
      if (isColourShaped(a) && isColourShaped(b)) sub.h = lerpHue(a.h, b.h, t);
      out[k] = sub;
    } else {
      out[k] = b;
    }
  }
  return out;
}
