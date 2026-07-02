// Event → action resolver. PURE: given a profile and one decoded MIDI event,
// find the matching control and produce a ResolvedAction with the value
// already scaled into engine units. Returns null when nothing matches (an
// unmapped control dispatches nothing — that silence IS the signal, never a
// wrapped no-op). The impure half (calling utils/api.ts) lives in dispatch.ts;
// keeping resolution pure is what makes it unit-testable with synthetic events.

import { ControllerProfile, ControlDef, Range } from './profile';
import { DecodedMidi, decodeMidi } from './midi_message';
import { scaleMidiToRange, MidiControlRef } from './learn';

// ResolvedAction has TWO producers:
//   1. resolveEvent() (this file, PURE, profile-driven) produces every kind
//      EXCEPT `localParam` — a decoded event mapped to a static profile action.
//   2. The controller runtime (manager.ts) builds `localParam` from the focused
//      entry's stored bindings + live exports (not profile-driven), then routes
//      it through the same coalescer + dispatcher seam.
// The dispatcher handles the engine-call kinds; `focusChannel` / `playlistScroll`
// / `playlistWindowSelect` are consumed by the runtime (controller-local state)
// and never reach an engine call.
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
  | { kind: 'globalEffectSlot'; slot: number }
  | { kind: 'playlistScroll'; layer: number; dir: 'up' | 'down' }
  | { kind: 'playlistWindowSelect'; layer: number; slot: number }
  | { kind: 'colorPalettePair'; palette: number }
  // Select which layer the learnable param faders (4-6) target. Handled in the
  // controller runtime (UI/controller state, not an engine call).
  | { kind: 'focusChannel'; layer: number }
  // A MIDI-learned local-param write. NOT produced by resolveEvent (which is
  // profile-driven) — the runtime builds it from the focused entry's stored
  // bindings + live exports, then routes it through the same coalescer +
  // dispatcher seam as every other continuous control.
  | { kind: 'localParam'; role: 'deck' | 'mixer'; channelId: string; exportId: number; value: number };

export interface ResolvedEvent {
  controlId: string;
  resolved: ResolvedAction;
  /** Continuous controls (CC) get coalesced; discrete (notes) dispatch now. */
  continuous: boolean;
}

const MIDI_MAX = 127;

// The single value→range scaler is learn.ts `scaleMidiToRange` (which also
// clamps out-of-spec bytes). `scale()` is a thin range-typed alias so the
// paramCenter / fader / sectionBrightness sites read cleanly.
function scale(value: number, range: Range): number {
  return scaleMidiToRange(value, range);
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
      case 'focusChannel':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'focusChannel', layer: a.layer } };
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

/**
 * Does a captured control already resolve to a STATIC profile action in the
 * given context? Returns the claiming control's id (so the caller can name it,
 * e.g. "CC 54 is GLOBAL SPEED") or null when the control is unmapped and thus
 * free to learn. Used to REJECT learning a control that would permanently
 * shadow a profile action (global speed, master, pads, …) — the faders/pads
 * reserved for learn are simply absent from the profile, so they return null.
 *
 * Pure: it synthesises the most-representative decoded event for the ref (a
 * mid-value CC, a full-velocity Note On) and runs it through resolveEvent.
 */
export function profileClaims(
  profile: ControllerProfile,
  ref: MidiControlRef,
  context?: string,
): string | null {
  const status = ref.type === 'cc' ? 0xb0 : 0x90;
  // CC: a mid value (64) resolves the same as any other for range/toggle
  // actions; Note On: full velocity so it is never mistaken for a Note Off.
  const value = ref.type === 'cc' ? 64 : 127;
  const ev = decodeMidi([status | (ref.channel & 0x0f), ref.number, value]);
  const resolved = resolveEvent(profile, ev, context);
  return resolved ? resolved.controlId : null;
}
