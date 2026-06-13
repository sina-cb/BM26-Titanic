// Event → action resolver. PURE: given a profile and one decoded MIDI event,
// find the matching control and produce a ResolvedAction with the value
// already scaled into engine units. Returns null when nothing matches (an
// unmapped control dispatches nothing — that silence IS the signal, never a
// wrapped no-op). The impure half (calling utils/api.ts) lives in dispatch.ts;
// keeping resolution pure is what makes it unit-testable with synthetic events.

import { ControllerProfile, ControlDef, Range } from './profile';
import { DecodedMidi } from './midi_message';

export type ResolvedAction =
  | { kind: 'paramCenter'; key: string; value: number }
  | { kind: 'master'; value: number }
  | { kind: 'pattern'; name: string }
  | { kind: 'patternBank'; bank: number; index: number }
  | { kind: 'blackoutToggle' }
  | { kind: 'globalEffect'; effect: string }
  | { kind: 'sectionBrightness'; sectionId: number; value: number }
  | { kind: 'groupFixedColor'; group: string; color: number[]; brightness: number }
  | { kind: 'mixerLayerFader'; layer: number; value: number }
  | { kind: 'mixerLayerSolo'; layer: number }
  | { kind: 'globalEffectSlot'; slot: number }
  | { kind: 'playlistScroll'; layer: number; dir: 'up' | 'down' }
  | { kind: 'playlistWindowSelect'; layer: number; slot: number }
  | { kind: 'colorPalettePair'; palette: number };

export interface ResolvedEvent {
  controlId: string;
  resolved: ResolvedAction;
  /** Continuous controls (CC) get coalesced; discrete (notes) dispatch now. */
  continuous: boolean;
}

const MIDI_MAX = 127;

/** Scale a 0-127 MIDI value into [min, max]. */
function scale(value: number, range: Range): number {
  const [min, max] = range;
  return min + (value / MIDI_MAX) * (max - min);
}

function matches(control: ControlDef, ev: DecodedMidi): { hit: boolean; index: number } {
  const m = control.match;
  if (m.type === 'cc' && ev.type === 'cc') {
    return { hit: ev.channel === m.channel && ev.cc === m.cc, index: 0 };
  }
  if (m.type === 'note' && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
    if (ev.channel !== m.channel) return { hit: false, index: 0 };
    const lo = m.notes[0];
    const hi = m.notes.length === 2 ? m.notes[1] : m.notes[0];
    if (ev.note < lo || ev.note > hi) return { hit: false, index: 0 };
    return { hit: true, index: ev.note - lo };
  }
  if (m.type === 'column' && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
    if (ev.channel !== m.channel) return { hit: false, index: 0 };
    const col = ev.note % 8;
    const row = Math.floor(ev.note / 8);
    if (col !== m.column || row < m.fromRow || row > m.toRow) return { hit: false, index: 0 };
    return { hit: true, index: m.reverse ? m.toRow - row : row - m.fromRow };
  }
  return { hit: false, index: 0 };
}

/**
 * Resolve one decoded event to a ResolvedEvent, or null if no control matches.
 * Discrete (note) actions fire on Note On only — Note Off is swallowed (v1 has
 * no momentary actions). Continuous (CC) actions always resolve.
 */
export function resolveEvent(
  profile: ControllerProfile,
  ev: DecodedMidi,
  context?: string,
): ResolvedEvent | null {
  if (ev.type === 'other') return null;
  const controls = context ? (profile.contexts[context] ?? profile.controls) : profile.controls;
  for (const control of controls) {
    const { hit, index } = matches(control, ev);
    if (!hit) continue;

    const a = control.action;
    // Discrete note presses: act on Note On, ignore Note Off.
    if (ev.type === 'noteOff') return null;

    switch (a.kind) {
      case 'paramCenter':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'paramCenter', key: a.key, value: scale(ev.value, a.range) } };
      case 'master':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'master', value: ev.value / MIDI_MAX } };
      case 'sectionBrightness':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'sectionBrightness', sectionId: a.sectionId, value: scale(ev.value, a.range) } };
      case 'mixerLayerFader':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'mixerLayerFader', layer: a.layer, value: scale(ev.value, a.range) } };
      case 'mixerLayerSolo':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'mixerLayerSolo', layer: a.layer } };
      case 'globalEffectSlot':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'globalEffectSlot', slot: a.slot } };
      case 'playlistScroll':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'playlistScroll', layer: a.layer, dir: a.dir } };
      case 'playlistWindowSelect':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'playlistWindowSelect', layer: a.layer, slot: index } };
      case 'colorPalettePair':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'colorPalettePair', palette: a.bank * 8 + index } };
      case 'pattern':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'pattern', name: a.name } };
      case 'patternBank':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'patternBank', bank: a.bank, index } };
      case 'blackoutToggle':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'blackoutToggle' } };
      case 'globalEffect':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'globalEffect', effect: a.effect } };
      case 'groupFixedColor':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'groupFixedColor', group: a.group, color: a.color, brightness: a.brightness } };
      default:
        return null;
    }
  }
  return null;
}
