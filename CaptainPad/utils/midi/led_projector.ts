// LED projector — PURE. Maps live engine + controller state onto the
// controller's LEDs and DIFFS against what was last sent so only changed LEDs
// go out (a full repaint is a projection against an empty previous state, used
// on connect / context switch).
//
// What it lights (docs/34 §3 + Sina's operator mapping):
//   - blackoutToggle / globalEffect / globalEffectSlot / mixerLayerSolo buttons
//     → on/off by the matching engine state (out-of-range slots / absent layers
//       stay dark)
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

export interface MidiProjectionState {
  blackout: boolean;
  activePattern: string | null;
  getGlobalEffectState(effect: string): boolean;
  resolvePatternForBank(bank: number, index: number): string | null;
  /** Does the Nth mixer layer exist? */
  layerExists(layer: number): boolean;
  /** Current solo of the Nth mixer layer. */
  getLayerSolo(layer: number): boolean;
  /** The focused layer index (whose pattern the param faders drive), or -1. */
  getFocusedLayer(): number;
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
}

/** note -> "status:velocity" of the last message sent for that note. */
export type LedState = Record<number, string>;

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
    case 'mixerLayerSolo':
      yield { note: pads[0].note, velocity: onOff(control.led, state.layerExists(a.layer) && state.getLayerSolo(a.layer)) };
      return;
    case 'focusChannel':
      // Single-colour track button: lit on the FOCUSED channel, dark otherwise
      // (incl. channels that don't exist). One lit button = "faders 4-6 drive
      // this channel's pattern."
      yield { note: pads[0].note, velocity: onOff(control.led, state.layerExists(a.layer) && state.getFocusedLayer() === a.layer) };
      return;
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
    if (!control.led && control.action.kind !== 'colorPalettePair') continue;
    for (const { note, velocity } of padVelocities(control, state)) {
      const channel = isRgbPad(note) ? (control.led?.channel ?? DEFAULT_PAD_CHANNEL) : 0;
      const msg = noteOn(channel, note, velocity);
      const key = `${msg[0]}:${msg[2]}`;
      next[note] = key;
      if (prev[note] !== key) messages.push(msg);
    }
  }
  return { messages, next };
}
