// Dispatch — the one impure seam where a ResolvedAction becomes a call to an
// existing utils/api.ts function. The mapping layer owns NO transport and adds
// NO new engine surface (docs/34 hard constraint): every action lands on a
// dispatch fn the on-screen UI already uses. The api + context are injected so
// the whole thing is unit-testable with mocks — tests assert the right fn was
// called with the right scaled value.

import { ResolvedAction } from './resolver';

export interface MidiApiResult { ok: boolean; error?: string }

/** The subset of utils/api.ts the MIDI layer dispatches through. */
export interface MidiDispatchApi {
  updateParamCenter(params: Record<string, unknown>): Promise<MidiApiResult>;
  updateMixerMaster(master: number): Promise<MidiApiResult>;
  setActivePattern(pattern: string): Promise<MidiApiResult>;
  setGlobalBlackout(state: boolean): Promise<MidiApiResult>;
  setGlobalEffect(effect: string, state: boolean): Promise<MidiApiResult>;
  setSectionBrightness(sectionId: number, brightness: number): Promise<MidiApiResult>;
  setGroupFixedColor(group: string, color: number[], brightness: number): Promise<MidiApiResult>;
  updateMixerChannel(channelId: string, updates: Record<string, unknown>): Promise<MidiApiResult>;
  updateDeckChannel(updates: Record<string, unknown>): Promise<MidiApiResult>;
  dispatchGlobalEffectSlotAction(slotId: number, action: string): Promise<MidiApiResult>;
  setGlobalEffectBlackout(enabled: boolean): Promise<MidiApiResult>;
  setChannelPlaylistEntry(role: 'deck' | 'mixer', channelId: string, entryId: string): Promise<MidiApiResult>;
  // Per-control STATIC writes for MIDI-learned local params. The deck has a
  // singleton route (no id); mixer overlays are addressed by channel id.
  setDeckChannelControl(id: number, v0: number, v1?: number, v2?: number): Promise<MidiApiResult>;
  setMixerChannelControl(channelId: string, id: number, v0: number, v1?: number, v2?: number): Promise<MidiApiResult>;
}

/** A resolved mixer "layer" — unified across tabs. On the Deck tab layer 0 is
 *  the deck channel (role 'deck', its own API); on the Mixer tab layers are the
 *  overlay channels (role 'mixer'). null when that layer doesn't exist. */
export interface MidiLayerRef { id: string; role: 'deck' | 'mixer' }

/** Live engine state the dispatcher needs to resolve toggles + banks. */
export interface MidiDispatchContext {
  /** Current global blackout (for blackoutToggle). */
  getBlackout(): boolean;
  /** Current state of a named global effect (for globalEffect toggle). */
  getGlobalEffectState(effect: string): boolean;
  /** Map a pattern-bank pad (bank, padIndex) to a pattern name, or null when
   *  no pattern sits behind that pad — an unlit pad dispatches nothing. */
  resolvePatternForBank(bank: number, index: number): string | null;
  /** The Nth "layer" for the active tab (deck channel on Deck, overlay on
   *  Mixer), or null when it doesn't exist. */
  getLayer(layer: number): MidiLayerRef | null;
  /** Curated palette pair (hues 0..1) at index, or null when out of range. */
  getColorPalette(index: number): { c1: number; c2: number } | null;
}

export type MidiDispatcher = (resolved: ResolvedAction) => Promise<void>;

export function createDispatcher(api: MidiDispatchApi, ctx: MidiDispatchContext): MidiDispatcher {
  return async (resolved: ResolvedAction): Promise<void> => {
    switch (resolved.kind) {
      case 'paramCenter':
        await api.updateParamCenter({ [resolved.key]: resolved.value });
        return;
      case 'master':
        await api.updateMixerMaster(resolved.value);
        return;
      case 'sectionBrightness':
        await api.setSectionBrightness(resolved.sectionId, resolved.value);
        return;
      case 'pattern':
        await api.setActivePattern(resolved.name);
        return;
      case 'patternBank': {
        const name = ctx.resolvePatternForBank(resolved.bank, resolved.index);
        if (name === null) return; // no pattern behind this pad — loud silence
        await api.setActivePattern(name);
        return;
      }
      case 'blackoutToggle':
        // The unified GEM e-stop ("stop all clips → blackout"): blacks out
        // pixels AND clears active macros/global effects.
        await api.setGlobalEffectBlackout(!ctx.getBlackout());
        return;
      case 'globalEffect':
        await api.setGlobalEffect(resolved.effect, !ctx.getGlobalEffectState(resolved.effect));
        return;
      case 'groupFixedColor':
        await api.setGroupFixedColor(resolved.group, resolved.color, resolved.brightness);
        return;
      case 'mixerLayerFader': {
        const L = ctx.getLayer(resolved.layer);
        if (!L) return; // layer doesn't exist — inert
        if (L.role === 'deck') await api.updateDeckChannel({ fader: resolved.value });
        else await api.updateMixerChannel(L.id, { fader: resolved.value });
        return;
      }
      case 'globalEffectSlot':
        await api.dispatchGlobalEffectSlotAction(resolved.slot, 'toggle');
        return;
      case 'colorPalettePair': {
        const p = ctx.getColorPalette(resolved.palette);
        if (!p) return; // no palette behind this pad — loud silence
        await api.updateParamCenter({
          colorPalette1: { h: p.c1, s: 1, v: 1 },
          colorPalette2: { h: p.c2, s: 1, v: 1 },
        });
        return;
      }
      case 'localParam':
        // A MIDI-learned local-param STATIC write. Route to the deck singleton
        // or the addressed mixer overlay channel. The render loop's audio
        // modulators stay layered on top of this base value untouched.
        if (resolved.role === 'deck') await api.setDeckChannelControl(resolved.exportId, resolved.value);
        else await api.setMixerChannelControl(resolved.channelId, resolved.exportId, resolved.value);
        return;
      case 'focusChannel':
      case 'playlistScroll':
      case 'playlistWindowSelect':
      case 'focusedParamDelta':
      case 'paramCenterDelta':
      case 'focusedParamReset':
      case 'focusStep':
        // These are RUNTIME-ONLY actions (controller-local state: focus
        // selection / per-layer window cursor / focused-channel delta math). The
        // runtime intercepts them BEFORE the dispatcher — reaching here means a
        // wiring bug, so fail loud rather than silently swallow (codex P0: no
        // silent no-ops).
        throw new Error(`dispatch: '${resolved.kind}' must be handled by the controller runtime, not dispatched`);
      default:
        // Exhaustiveness guard — a new ResolvedAction kind must add a case.
        throw new Error(`dispatch: unhandled ResolvedAction kind '${(resolved as { kind: string }).kind}'`);
    }
  };
}
