// LED projector — PURE. Maps live engine + controller state onto the
// controller's LEDs and DIFFS against what was last sent so only changed LEDs
// go out (a full repaint is a projection against an empty previous state, used
// on connect / context switch).
//
// What it lights (docs/34 §3 + Sina's operator mapping):
//   - blackoutToggle / globalEffect / globalEffectSlot buttons
//     → on/off by the matching engine state (out-of-range slots / absent layers
//       stay dark)
//   - focusChannel track button → the FOCUSED channel lit solid; while a bound
//       fader is pickup-locked it BLINKS (velocity `flash`, default = `on`);
//       non-focused / absent channels stay dark
//   - patternBank pads → the pad whose pattern == active pattern lit 'active',
//     the rest 'idle'; an empty pad stays dark
//   - pattern button → lit 'active' when it is the active pattern
//   - playlist window browser (column): the 6-entry window dim, the active
//     entry bright, scroll pads lit when scrollable, out-of-range dark
//   - colour-pair pads (column): each pad shows its palette hue (c1 on even
//     colour columns, c2 on odd)
//
// APC mini mk2 LED encoding (see apc_mini_mk2_reference.md): RGB grid pads
// (note 0-63) use Note On with channel = brightness/behaviour (default 6 =
// solid 100%) + velocity = colour; single-colour buttons (note 0x64-0x77) use
// channel 0 with velocity 0x00 off / 0x01 on.

import { ControllerProfile, ControlDef, LedSpec, ControlMatch } from './profile';
import { noteOn } from './midi_message';
import { setRingValue, setColor, setAnimation } from './mft/messages';
import { ColorValues, AnimationValues, MidiChannels } from './mft/constants';

export interface MidiProjectionState {
  blackout: boolean;
  activePattern: string | null;
  getGlobalEffectState(effect: string): boolean;
  resolvePatternForBank(bank: number, index: number): string | null;
  /** Does the Nth mixer layer exist? */
  layerExists(layer: number): boolean;
  /** The focused layer index (whose pattern the param faders drive), or -1. */
  getFocusedLayer(): number;
  /** Is the focused channel currently pickup-LOCKED (a bound fader hasn't yet
   *  crossed the param value)? Drives the focus track button's blink. */
  isFocusLocked(): boolean;
  /** Is global-effect slot N (1-based) active? */
  getGlobalEffectSlotActive(slot: number): boolean;
  /** How many global-effect slots exist (slots beyond this stay dark). */
  globalEffectSlotCount: number;
  // ── Stage 2 ──
  /** Number of entries in the Nth layer's playlist. */
  getLayerPlaylistLength(layer: number): number;
  /** Index of the active entry in the Nth layer's playlist (-1 if none). */
  getLayerActiveEntryIndex(layer: number): number;
  /** Top index of the 6-entry browse window for the Nth layer. */
  getWindowCursor(layer: number): number;
  /** Browse window size (pads). */
  windowSize: number;
  /** Curated palette pair (hues 0..1) at index, or null when out of range. */
  getColorPaletteHue(index: number): { c1: number; c2: number } | null;
  // ── Driver #2 — MIDI Fighter Twister ring feedback (best-effort) ──
  /** Current value (0..1) of the FOCUSED channel's ordered export at `index`,
   *  for a `focusedParamKnob` ring, or null when no param sits behind that knob
   *  (ring dark). Optional so APC-only projection needs no new state. */
  getFocusedExportValue?(index: number): number | null;
  /** Current value (0..1) of a CPC global param by key (bank-2 rings), or null
   *  when the key is unknown (ring dark). */
  getGlobalParamValue?(key: string): number | null;
  /** Identity colour (an MFT colour-wheel value) of the focused channel, for the
   *  knob rings — deck vs overlay 1/2/3. Optional; omitted → no colour write. */
  getFocusedIdentityColor?(): number | null;
  /** Is the FOCUSED channel's ordered export at `index` audio-MODULATED? Drives
   *  a ring PULSE on that encoder (a modulated param's ring visibly breathes).
   *  Optional; omitted → no pulse (steady ring). */
  getFocusedExportModulated?(index: number): boolean;
  /** Global-param keys the engine is CURRENTLY driving itself (the shared
   *  `syncOwnedKeys` snapshot fact — contract I4). A `paramCenterRelative` ring
   *  whose key is in this set STROBES — the "sync owns this param" cue — and its
   *  knob is inert to manual writes at the flush layer. Read-only here; the SAME
   *  set the dispatch gate consults, so the display can never disagree with the
   *  gate (was a hardcoded `'speed'` literal + `isBpmSpeedSyncOn`). */
  syncOwnedKeys: ReadonlySet<string>;
}

/** LED diff key -> the last message bytes sent for it (as "b0:b1:b2"), so only
 *  changed LEDs re-send. Keyed by `(statusByte, number)` — e.g. "144:107" for
 *  an APC note button, "176:5" for an MFT ring CC — so a note and a CC on the
 *  same number never collide (the MFT rings and switches share encoder numbers
 *  across channels). Numeric note keys from the APC path stay backward-shaped
 *  via the same string key. */
export type LedState = Record<string, string>;

export interface LedProjection {
  messages: number[][];
  next: LedState;
}

const RGB_PAD_MAX_NOTE = 0x3f;
const DEFAULT_PAD_CHANNEL = 6; // solid 100%

function isRgbPad(note: number): boolean {
  return note <= RGB_PAD_MAX_NOTE;
}

/** Map a hue (0..1) to the nearest APC mk2 palette colour velocity (coarse —
 *  for indication, not fidelity). See the colour chart in the reference doc. */
export function hueToApcVelocity(h: number): number {
  // Finer wheel than v1 so green/lime hues don't collapse onto yellow.
  const wheel: [number, number][] = [
    [0.00, 5],   // red
    [0.055, 9],  // orange
    [0.13, 13],  // yellow
    [0.22, 74],  // lime
    [0.30, 17],  // bright green
    [0.36, 21],  // green
    [0.45, 33],  // spring
    [0.52, 78],  // cyan
    [0.60, 41],  // azure
    [0.66, 45],  // blue
    [0.74, 49],  // violet
    [0.83, 53],  // magenta
    [0.92, 57],  // pink
    [1.00, 5],   // red (wrap)
  ];
  const hue = ((h % 1) + 1) % 1;
  let best = wheel[0];
  let bestD = 1;
  for (const entry of wheel) {
    const d = Math.min(Math.abs(entry[0] - hue), 1 - Math.abs(entry[0] - hue));
    if (d < bestD) { bestD = d; best = entry; }
  }
  return best[1];
}

/** The pad notes a match occupies, with each pad's index. */
function matchPads(m: ControlMatch): { note: number; index: number }[] {
  if (m.type === 'cc') return [];
  if (m.type === 'column') {
    const out: { note: number; index: number }[] = [];
    for (let row = m.fromRow; row <= m.toRow; row++) {
      out.push({ note: row * 8 + m.column, index: m.reverse ? m.toRow - row : row - m.fromRow });
    }
    return out;
  }
  const lo = m.notes[0];
  const hi = m.notes.length === 2 ? m.notes[1] : m.notes[0];
  const out: { note: number; index: number }[] = [];
  for (let n = lo; n <= hi; n++) out.push({ note: n, index: n - lo });
  return out;
}

function onOff(led: LedSpec | undefined, on: boolean): number {
  const s = led ?? {};
  return on ? (s.on ?? 1) : (s.off ?? 0);
}
function activeIdle(led: LedSpec | undefined, active: boolean): number {
  const s = led ?? {};
  return active ? (s.active ?? 1) : (s.idle ?? 0);
}

/** Compute the velocity each pad of a control should show (0 = off). */
function* padVelocities(
  control: ControlDef,
  state: MidiProjectionState,
): Generator<{ note: number; velocity: number }> {
  const m = control.match;
  if (m.type === 'cc') return;
  const a = control.action;
  const pads = matchPads(m);

  switch (a.kind) {
    case 'blackoutToggle':
      yield { note: pads[0].note, velocity: onOff(control.led, state.blackout) };
      return;
    case 'globalEffect':
      yield { note: pads[0].note, velocity: onOff(control.led, state.getGlobalEffectState(a.effect)) };
      return;
    case 'globalEffectSlot': {
      const present = a.slot <= state.globalEffectSlotCount;
      yield { note: pads[0].note, velocity: present ? onOff(control.led, state.getGlobalEffectSlotActive(a.slot)) : 0 };
      return;
    }
    case 'focusChannel': {
      // Single-colour track button: dark on absent / non-focused channels.
      // The focused channel is lit SOLID (`on`), or BLINKS (`flash`, default =
      // `on` when the profile omits it) while a bound fader is pickup-locked —
      // the visual cue Sina's spec promised for soft-takeover.
      const focused = state.layerExists(a.layer) && state.getFocusedLayer() === a.layer;
      let velocity = onOff(control.led, false); // off
      if (focused) {
        velocity = state.isFocusLocked()
          ? (control.led?.flash ?? control.led?.on ?? 1)
          : onOff(control.led, true);
      }
      yield { note: pads[0].note, velocity };
      return;
    }
    case 'pattern':
      yield { note: pads[0].note, velocity: activeIdle(control.led, state.activePattern === a.name) };
      return;
    case 'patternBank':
      for (const p of pads) {
        const name = state.resolvePatternForBank(a.bank, p.index);
        yield { note: p.note, velocity: name === null ? 0 : activeIdle(control.led, name === state.activePattern) };
      }
      return;
    case 'playlistScroll': {
      if (!state.layerExists(a.layer)) { yield { note: pads[0].note, velocity: 0 }; return; }
      const cursor = state.getWindowCursor(a.layer);
      const len = state.getLayerPlaylistLength(a.layer);
      const canScroll = a.dir === 'up'
        ? cursor > 0
        : cursor + state.windowSize < len;
      yield { note: pads[0].note, velocity: onOff(control.led, canScroll) };
      return;
    }
    case 'playlistWindowSelect': {
      const exists = state.layerExists(a.layer);
      const cursor = state.getWindowCursor(a.layer);
      const len = state.getLayerPlaylistLength(a.layer);
      const activeIdx = state.getLayerActiveEntryIndex(a.layer);
      for (const p of pads) {
        const entryIdx = cursor + p.index;
        let velocity = 0;
        if (exists) {
          velocity = entryIdx < len
            ? (entryIdx === activeIdx ? (control.led?.active ?? 21) : (control.led?.idle ?? 45))
            : 1; // dim frame — keep the 6-slot window rectangle visible even past the end
        }
        yield { note: p.note, velocity };
      }
      return;
    }
    case 'colorPalettePair': {
      // Even colour column shows c1, odd shows c2 (col5/col7 = c1, col6/col8 = c2).
      const showC1 = m.type === 'column' ? m.column % 2 === 0 : true;
      for (const p of pads) {
        const pal = state.getColorPaletteHue(a.bank * 8 + p.index);
        yield { note: p.note, velocity: pal ? hueToApcVelocity(showC1 ? pal.c1 : pal.c2) : 0 };
      }
      return;
    }
    default:
      return;
  }
}

/** A single LED target BEFORE construction: the diff key it occupies and the
 *  value byte it wants, plus a lazy `build` that assembles the concrete 3-byte
 *  MIDI message ONLY when the diff says it changed. `key` is the same
 *  `"status:number"` string in `LedState`, so it diffs against `prev`
 *  directly; no message array / template-string / `String()` is allocated on
 *  the no-change path (finding 12c). */
interface LedTarget {
  key: string;
  value: number;
  build(): number[];
}

/** Emit the ring/colour LED TARGETS for a `focusedParamKnob` or
 *  `paramCenterRelative` control (MFT). Ring value = the live param value scaled
 *  0-127; colour = the focused channel's identity (when the projection state
 *  supplies it). A knob with no param behind it goes dark (ring 0). Yields
 *  nothing for a non-relative control or when the projection state lacks the MFT
 *  getters (APC-only path). Each target's `build` is lazy — no CC array is
 *  constructed until the diff proves the value changed (finding 12c). */
function* ringTargets(
  control: ControlDef,
  state: MidiProjectionState,
): Generator<LedTarget> {
  const a = control.action;
  if (a.kind === 'focusedParamKnob') {
    if (!state.getFocusedExportValue) return;
    const v = state.getFocusedExportValue(a.index);
    const ring = v === null ? 0 : Math.round(clampUnit(v) * 127);
    yield ringTarget(a.index, ring);
    if (v !== null && state.getFocusedIdentityColor) {
      const color = state.getFocusedIdentityColor();
      if (color !== null) yield colorTarget(a.index, color);
    } else {
      // No param behind the knob — dark it (inactive colour).
      yield colorTarget(a.index, ColorValues.INACTIVE);
    }
    // Ring PULSE when the param is audio-MODULATED (the ring breathes at 1 beat
    // so the operator sees the modulator is driving it); NONE otherwise. A knob
    // with no param behind it (v === null) never pulses.
    const modulated = v !== null && !!state.getFocusedExportModulated?.(a.index);
    yield animationTarget(a.index, modulated ? AnimationValues.RGB_PULSE_1_BEAT : AnimationValues.NONE);
    return;
  }
  if (a.kind === 'paramCenterRelative') {
    if (!state.getGlobalParamValue) return;
    // The ring index for a bank-2 knob is the encoder number the profile pins on
    // the relative match's CC (encoder N → CC N on ch0). Read it off the match.
    const enc = control.match.type === 'cc' ? control.match.cc : null;
    if (enc === null) return;
    const v = state.getGlobalParamValue(a.key);
    yield ringTarget(enc, v === null ? 0 : Math.round(clampUnit(v) * 127));
    // STROBE the ring when the engine owns this key (the shared syncOwnedKeys
    // fact — contract I4); a steady (NONE) ring otherwise. ANY sync-owned key
    // carries the cue, and the display reads the SAME set the dispatch gate uses
    // so the two can never drift (was a `'speed'` literal + isBpmSpeedSyncOn).
    const strobe = state.syncOwnedKeys.has(a.key);
    yield animationTarget(enc, strobe ? AnimationValues.RGB_TOGGLE_1_BEAT : AnimationValues.NONE);
  }
}

// The three MFT CC channels are fixed by the message builders. Precompute the
// status byte for each so a target's diff key is a cheap string join, and the
// full CC array is built only on change (via the matching setter).
const RING_STATUS = 0xb0 | MidiChannels.ROTARY_ENCODER;
const COLOR_STATUS = 0xb0 | MidiChannels.SWITCH_AND_COLOR;
const ANIM_STATUS = 0xb0 | MidiChannels.ANIMATIONS_AND_BRIGHTNESS;

function ringTarget(enc: number, value: number): LedTarget {
  return { key: `${RING_STATUS}:${enc}`, value, build: () => setRingValue(enc, value) };
}
function colorTarget(enc: number, value: number): LedTarget {
  return { key: `${COLOR_STATUS}:${enc}`, value, build: () => setColor(enc, value) };
}
function animationTarget(enc: number, value: number): LedTarget {
  return { key: `${ANIM_STATUS}:${enc}`, value, build: () => setAnimation(enc, value) };
}

function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Yield the APC pad/button LED TARGETS for a control (notes keyed by
 *  (status, note)). Like `ringTargets`, each target's `build` is lazy so an
 *  unchanged pad allocates no `noteOn` array (finding 12c). */
function* padTargets(
  control: ControlDef,
  state: MidiProjectionState,
): Generator<LedTarget> {
  if (!control.led && control.action.kind !== 'colorPalettePair') return;
  for (const { note, velocity } of padVelocities(control, state)) {
    const channel = isRgbPad(note) ? (control.led?.channel ?? DEFAULT_PAD_CHANNEL) : 0;
    const status = (0x90 | (channel & 0x0f)) & 0xff;
    yield { key: `${status}:${note}`, value: velocity, build: () => noteOn(channel, note, velocity) };
  }
}

export function projectLeds(
  profile: ControllerProfile,
  state: MidiProjectionState,
  prev: LedState,
  context?: string,
): LedProjection {
  const next: LedState = {};
  const messages: number[][] = [];
  const controls = context ? (profile.contexts[context] ?? profile.controls) : profile.controls;
  for (const control of controls) {
    // APC pad/button feedback + MFT ring/colour feedback share the same
    // diff-before-construct path (finding 12c): compute each target's value and
    // its cheap "status:number" key, record it in `next`, and CONSTRUCT the
    // 3-byte MIDI array only when the value actually changed vs `prev`.
    for (const t of padTargets(control, state)) {
      const cur = String(t.value);
      next[t.key] = cur;
      if (prev[t.key] !== cur) messages.push(t.build());
    }
    for (const t of ringTargets(control, state)) {
      const cur = String(t.value);
      next[t.key] = cur;
      if (prev[t.key] !== cur) messages.push(t.build());
    }
  }
  // #9 orphan-off: any key lit in `prev` but ABSENT from `next` (the projected
  // key set shrank — a future divergent profile / VSN1 context switch) would
  // otherwise stay stuck lit. Emit an explicit OFF for each vanished key. The
  // key is "status:number"; value 0 is the off for BOTH a note (0x9n n 0 =
  // note-off) and a CC ring/colour/animation (0xbn n 0 = clear). Skip keys
  // already at 0 in prev — they are dark; re-sending 0 would be noise.
  for (const key in prev) {
    if (key in next) continue;
    if (prev[key] === '0') continue;
    const sep = key.indexOf(':');
    const status = Number(key.slice(0, sep));
    const number = Number(key.slice(sep + 1));
    messages.push([status, number, 0]);
    next[key] = '0';
  }
  return { messages, next };
}
