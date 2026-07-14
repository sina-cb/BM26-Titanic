// Pins the APC mini mk2 OPERATOR RE-LAYOUT (2026-07) against the REAL shipped
// midi_profiles/apc_mini_mk2.yaml (not a synthetic fixture), so any future edit
// that scrambles the button map, drops the 4th-channel fader, or re-lights an
// unassigned key fails here.
//
// Authoritative note map (fresh mk2 discovery capture; ch0, note-on 0x90):
//   volume=100 pan=101 send=102 device=103  → FOCUS channel 0/1/2/3
//   up=104 down=105 left=106 right=107       → UNASSIGNED, DRIVEN DARK (ledOff)
//   clip_stop=112                            → combined AUTOPILOT toggle (LED tracks it)
//   mute=114 rec_arm=115 select=116 drum=117 note=118 → UNASSIGNED, DRIVEN DARK; solo=113 → performanceDialog
//   stop_all_clips=119                       → e-stop BLACKOUT toggle (LED tracks blackout)
//   shift=122                                → Deck ↔ Mixer view toggle (no LED)
// Faders: CC 48-51 → mixer channels 0-3 (the 4th-fader fix); CC 52-55 learn;
//         CC 56 → master.
//
// UNUSED-BUTTON LED HYGIENE (2026-07 fix): the arrows + unused scene buttons no
// longer merely OMIT a control — they carry an explicit `ledOff` control so
// CaptainPad drives a note-off (velocity 0) to each on connect, clearing the
// APC's LATCHED LED (the operator's "REC ARM / MUTE still lit" bug). They still
// resolve to NOTHING on press (loud silence) — `ledOff` is projection-only.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile, ControlDef } from './profile';
import { resolveEvent, profileClaims } from './resolver';
import { projectLeds, MidiProjectionState } from './led_projector';
import { decodeMidi } from './midi_message';
import { MidiManager, MidiEngineSnapshot } from './manager';
import { MidiDispatchApi } from './dispatch';
import { MidiTransport, MidiEndpoint, MidiMessageEvent } from './transport';

const apcRaw = yaml.load(
  readFileSync(join(__dirname, '../../midi_profiles/apc_mini_mk2.yaml'), 'utf8'),
);
const apc = validateProfile(apcRaw, 'apc_mini_mk2.yaml');

// Notes that must resolve to nothing in the new layout (arrows + the unused
// scene-column buttons). An unmapped control is loud silence AND stays dark.
// solo (113) left this list 2026-07-13: it is now the PERFORMANCE/EDIT mode
// dialog summon (see the dedicated tests below).
const UNASSIGNED_NOTES = [104, 105, 106, 107, 114, 115, 116, 117, 118];

describe('apc_mini_mk2 operator re-layout — inbound button/fader mapping', () => {
  for (const ctxName of ['deck', 'mixer']) {
    describe(`context '${ctxName}'`, () => {
      const on = (note: number) => resolveEvent(apc, decodeMidi([0x90, note, 127]), ctxName);
      const cc = (num: number, val: number) => resolveEvent(apc, decodeMidi([0xb0, num, val]), ctxName);

      it('top soft-buttons 100-103 focus channels 0-3', () => {
        expect(on(100)?.resolved).toEqual({ kind: 'focusChannel', layer: 0 });
        expect(on(101)?.resolved).toEqual({ kind: 'focusChannel', layer: 1 });
        expect(on(102)?.resolved).toEqual({ kind: 'focusChannel', layer: 2 });
        expect(on(103)?.resolved).toEqual({ kind: 'focusChannel', layer: 3 });
      });

      it('clip_stop (112) → combined autopilot toggle', () => {
        expect(on(112)?.resolved).toEqual({ kind: 'autopilotToggle' });
      });

      it('solo (113) → performance-mode dialog summon (never a blind engine toggle)', () => {
        expect(on(113)?.resolved).toEqual({ kind: 'performanceDialog' });
      });

      it('stop_all_clips (119) → e-stop blackout toggle (NOT master fade)', () => {
        expect(on(119)?.resolved).toEqual({ kind: 'blackoutToggle' });
      });

      it('shift (122) → view toggle (Deck ↔ Mixer)', () => {
        expect(on(122)?.resolved).toEqual({ kind: 'viewToggle' });
      });

      it('arrows + unused scene buttons (104-107, 114-118) resolve to NOTHING', () => {
        for (const note of UNASSIGNED_NOTES) {
          expect(on(note), `note ${note} must be unmapped`).toBeNull();
        }
      });

      // ── THE 4TH-FADER FIX ──
      // Physical faders 1-4 = CC 48-51 → mixer channels (layers) 0-3. The bug was
      // that CC 51 (fader 4) was an unmapped learn fader, so it moved no channel;
      // it must now resolve to mixerLayerFader layer 3.
      it('faders 1-4 (CC 48-51) drive mixer channels 0-3 — incl. the fixed 4th', () => {
        expect(cc(48, 127)?.resolved).toEqual({ kind: 'mixerLayerFader', layer: 0, value: 1 });
        expect(cc(49, 127)?.resolved).toEqual({ kind: 'mixerLayerFader', layer: 1, value: 1 });
        expect(cc(50, 127)?.resolved).toEqual({ kind: 'mixerLayerFader', layer: 2, value: 1 });
        // The fix: CC 51 → layer 3 (was previously null / a learn fader).
        expect(cc(51, 127)?.resolved).toEqual({ kind: 'mixerLayerFader', layer: 3, value: 1 });
      });

      it('the 4th channel fader (CC 51) is a CONTROLLED profile action, not free-to-learn', () => {
        // profileClaims returns the claiming control id, proving CC 51 is no
        // longer an unmapped learn fader (the root cause of the operator's bug).
        expect(profileClaims(apc, { type: 'cc', channel: 0, number: 51 }, ctxName)).toBe('fader_4_channel4');
      });

      it('faders 5-8 (CC 52-55) stay UNMAPPED (reserved for MIDI-learn local params)', () => {
        for (const num of [52, 53, 54, 55]) {
          expect(cc(num, 64), `CC ${num} must be a free learn fader`).toBeNull();
          expect(profileClaims(apc, { type: 'cc', channel: 0, number: num }, ctxName)).toBeNull();
        }
      });

      it('fader 9 (CC 56) → master', () => {
        expect(cc(56, 127)?.resolved).toEqual({ kind: 'master', value: 1 });
      });

      it('has EXACTLY ONE blackout control (stop_all_clips) and NO globalEffectSlot', () => {
        const controls = apc.contexts[ctxName];
        // stop_all_clips is now the e-stop blackout toggle — exactly one, on 119.
        const blackouts = controls.filter((c: ControlDef) => c.action.kind === 'blackoutToggle');
        expect(blackouts.length).toBe(1);
        expect(blackouts[0].id).toBe('stop_all_clips_blackout');
        // Per-slot global-effect pads stayed OFF the APC (moved to the VSN1).
        expect(controls.some((c: ControlDef) => c.action.kind === 'globalEffectSlot')).toBe(false);
      });
    });
  }
});

describe('apc_mini_mk2 operator re-layout — LED hygiene (unassigned buttons DRIVEN dark)', () => {
  for (const ctxName of ['deck', 'mixer']) {
    it(`context '${ctxName}': arrows + unused scene buttons emit an EXPLICIT LED-OFF on connect`, () => {
      // A full projection from an empty prev is the on-connect repaint. Each
      // unassigned button must now emit a NOTE-OFF (channel 0, velocity 0) so
      // the APC's latched LED is actively cleared — the "REC ARM / MUTE still
      // lit" fix. (Merely omitting the control is not enough: the APC keeps
      // whatever it last showed.)
      const { messages } = projectLeds(apc, projState({}), {}, ctxName);
      for (const note of UNASSIGNED_NOTES) {
        expect(messages, `unassigned note ${note} must be driven OFF (0x90 ${note} 0)`)
          .toContainEqual([0x90, note, 0]);
      }
    });

    it(`context '${ctxName}': an unassigned button NEVER lights (velocity stays 0 for any state)`, () => {
      // Even with blackout on + autopilot on + a focused layer, none of the
      // unassigned notes may carry a non-zero velocity: they are ledOff-only.
      const { messages } = projectLeds(
        apc,
        projState({ blackout: true, getCombinedAutopilotActive: () => true, layerExists: () => true, getFocusedLayer: () => 0 }),
        {},
        ctxName,
      );
      const lit = messages.filter(
        (m) => (m[0] & 0xf0) === 0x90 && UNASSIGNED_NOTES.includes(m[1]) && m[2] !== 0,
      );
      expect(lit, `unassigned notes must never carry velocity > 0: ${JSON.stringify(lit)}`).toEqual([]);
    });

    it(`context '${ctxName}': the focus buttons light only the focused channel`, () => {
      // Channel 2 focused (layer 2 exists + focused) → note 102 lit solid (on=1);
      // the other focus buttons (100/101/103) dark.
      const { messages } = projectLeds(
        apc,
        projState({ layerExists: (l) => l <= 3, getFocusedLayer: () => 2 }),
        {},
        ctxName,
      );
      expect(messages).toContainEqual([0x90, 102, 1]); // send = focus ch2, lit
      expect(messages).toContainEqual([0x90, 100, 0]); // volume = ch0, dark
      expect(messages).toContainEqual([0x90, 101, 0]); // pan = ch1, dark
      expect(messages).toContainEqual([0x90, 103, 0]); // device = ch3, dark
    });
  }
});

describe('apc_mini_mk2 operator re-layout — state-tracking button LEDs', () => {
  for (const ctxName of ['deck', 'mixer']) {
    describe(`context '${ctxName}'`, () => {
      it('clip_stop (112) LED lights when combined autopilot is ON', () => {
        const { messages } = projectLeds(apc, projState({ getCombinedAutopilotActive: () => true }), {}, ctxName);
        expect(messages).toContainEqual([0x90, 112, 1]); // lit
      });

      it('clip_stop (112) LED is dark when combined autopilot is OFF', () => {
        const { messages } = projectLeds(apc, projState({ getCombinedAutopilotActive: () => false }), {}, ctxName);
        expect(messages).toContainEqual([0x90, 112, 0]); // dark
      });

      it('clip_stop (112) LED FLIPS with the autopilot state (diffs on change)', () => {
        const off = projectLeds(apc, projState({ getCombinedAutopilotActive: () => false }), {}, ctxName);
        const on = projectLeds(apc, projState({ getCombinedAutopilotActive: () => true }), off.next, ctxName);
        expect(on.messages).toContainEqual([0x90, 112, 1]); // only the changed LED re-sends
      });

      it('stop_all_clips (119) LED lights when blacked out, dark otherwise', () => {
        const lit = projectLeds(apc, projState({ blackout: true }), {}, ctxName);
        expect(lit.messages).toContainEqual([0x90, 119, 1]);
        const dark = projectLeds(apc, projState({ blackout: false }), {}, ctxName);
        expect(dark.messages).toContainEqual([0x90, 119, 0]);
      });

      it('solo (113) LED lights while performance mode is ACTIVE, dark in edit mode', () => {
        const lit = projectLeds(apc, projState({ getPerformanceModeActive: () => true }), {}, ctxName);
        expect(lit.messages).toContainEqual([0x90, 113, 1]);
        const dark = projectLeds(apc, projState({ getPerformanceModeActive: () => false }), {}, ctxName);
        expect(dark.messages).toContainEqual([0x90, 113, 0]);
      });

      it('solo (113) LED is dark on a pre-field projection state (no getter)', () => {
        // A snapshot that predates performanceModeActive must read as inactive,
        // never lit-from-undefined.
        const { messages } = projectLeds(apc, projState({}), {}, ctxName);
        expect(messages).toContainEqual([0x90, 113, 0]);
      });
    });
  }
});

// ── Real-profile INTEGRATION: drive the shipped YAML through a MidiManager +
//    fake transport, proving the fader-3 fix and the three button dispatches
//    reach the right injected api method end-to-end. ──────────────────────────
const fullEndpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
  { id: 'out-0', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
];

class FakeTransport implements MidiTransport {
  sent: number[][] = [];
  private msgCbs = new Set<(e: MidiMessageEvent) => void>();
  private openedDest: string | null = null;
  async listEndpoints() { return fullEndpoints; }
  async openSource() { /* no-op */ }
  async openDestination(id: string) { this.openedDest = id; }
  send(bytes: number[]) { if (!this.openedDest) throw new Error('no dest'); this.sent.push(bytes); }
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): () => void;
  addListener(event: 'endpointsChanged', cb: () => void): () => void;
  addListener(event: 'midiMessage' | 'endpointsChanged', cb: ((e: MidiMessageEvent) => void) | (() => void)) {
    if (event === 'midiMessage') { this.msgCbs.add(cb as (e: MidiMessageEvent) => void); return () => this.msgCbs.delete(cb as (e: MidiMessageEvent) => void); }
    return () => undefined;
  }
  close() { this.msgCbs.clear(); }
  emit(data: number[]) { for (const cb of this.msgCbs) cb({ sourceId: 'in-0', data, timestampMs: 0 }); }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setGlobalEffectSlotIntensity: vi.fn(ok), resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok), cycleGlobalEffectSlotMode: vi.fn(ok), setControllerProfile: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok), disableAllGlobalEffects: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok), setDeckChannelControl: vi.fn(ok),
    setMixerChannelControl: vi.fn(ok), setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok), toggleCombinedAutopilot: vi.fn(ok), toggleMasterFade: vi.fn(ok), summonPerformanceDialog: vi.fn(ok),
  };
}

// Four mixer overlay channels so layer 3 (the 4th fader's target) exists.
const fourChannelSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: [], globalEffects: {},
  layers: [
    { id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }, { id: 'ch2', fader: 1 }, { id: 'ch3', fader: 1 },
  ],
  deckLayer: null, activeContext: 'mixer', globalEffectSlots: [], colorPalettes: [],
  focused: null, syncOwnedKeys: new Set<string>(),
};

function integrationSetup(snap: MidiEngineSnapshot) {
  const transport = new FakeTransport();
  const api = makeApi();
  const manager = new MidiManager({
    profiles: [apc], transportFactory: () => transport, api,
    getSnapshot: () => snap, defaultContext: 'mixer', reconnectDebounceMs: 0,
  });
  return { transport, api, manager };
}

describe('apc_mini_mk2 operator re-layout — real-profile integration (fake transport)', () => {
  it('THE FADER-3 FIX: fader 4 (CC 51) moves the 4th mixer channel (layer 3)', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0xb0, 51, 127]); // physical fader 4, full
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch3', { fader: 1 });
  });

  it('faders 1-4 (CC 48-51) each move their own channel 0-3', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0xb0, 48, 127]);
    transport.emit([0xb0, 49, 127]);
    transport.emit([0xb0, 50, 127]);
    transport.emit([0xb0, 51, 127]);
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch0', { fader: 1 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch1', { fader: 1 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch2', { fader: 1 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch3', { fader: 1 });
  });

  it('clip_stop (112) → toggleCombinedAutopilot()', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 112, 127]);
    expect(api.toggleCombinedAutopilot).toHaveBeenCalledTimes(1);
  });

  it('stop_all_clips (119) → e-stop blackout (POST blackout, flipped from current), NOT master fade', async () => {
    // Snapshot reports NOT blacked out → the press must toggle TO blackout on.
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 119, 127]);
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledTimes(1);
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledWith(true); // flipped from blackout:false
    // The fade path is fully detached from the button.
    expect(api.toggleMasterFade).not.toHaveBeenCalled();
  });

  it('stop_all_clips (119) toggles OFF when already blacked out', async () => {
    const { manager, api, transport } = integrationSetup({ ...fourChannelSnap, blackout: true });
    await manager.start();
    transport.emit([0x90, 119, 127]);
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledWith(false); // flipped from blackout:true
  });

  it('shift (122) → toggleDeckMixerView()', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 122, 127]);
    expect(api.toggleDeckMixerView).toHaveBeenCalledTimes(1);
  });

  it('solo (113) → summonPerformanceDialog() — the UI sheet, never an engine write', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 113, 127]);
    expect(api.summonPerformanceDialog).toHaveBeenCalledTimes(1);
    // The press must NOT blind-toggle anything engine-side.
    expect(api.setGlobalBlackout).not.toHaveBeenCalled();
    expect(api.updateMixerChannel).not.toHaveBeenCalled();
  });

  it('SOLO → open, SOLO again → confirm: both presses reach the summon seam', async () => {
    // The press-twice-to-GO-LIVE contract end-to-end at the MIDI layer: two
    // physical presses = two summons. The FIRST opens the enter-confirm sheet
    // and the SECOND confirms — that decision is the UI-side
    // performanceSummonOutcome ('confirmEnter'), pinned in
    // components/performance_mode_logic.test.ts; the dispatcher's job (proven
    // here) is to deliver EVERY press to the summon seam, never swallowing the
    // second one or writing to the engine itself.
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 113, 127]); // opens the enter-confirm sheet
    transport.emit([0x90, 113, 127]); // confirms (GO LIVE) via the outcome fn
    expect(api.summonPerformanceDialog).toHaveBeenCalledTimes(2);
    expect(api.setGlobalBlackout).not.toHaveBeenCalled();
  });

  it('an arrow (105) and an unused scene button (114) dispatch NOTHING', async () => {
    const { manager, api, transport } = integrationSetup(fourChannelSnap);
    await manager.start();
    transport.emit([0x90, 105, 127]); // down arrow
    transport.emit([0x90, 114, 127]); // mute
    // No engine call of any kind fired for either press.
    for (const fn of Object.values(api)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

// Minimal MidiProjectionState with every getter defaulting to "nothing lit",
// so a test only overrides the fields it cares about.
function projState(over: Partial<MidiProjectionState> = {}): MidiProjectionState {
  return {
    blackout: false,
    activePattern: null,
    getCombinedAutopilotActive: () => false,
    getGlobalEffectState: () => false,
    resolvePatternForBank: () => null,
    layerExists: () => false,
    getFocusedLayer: () => -1,
    isFocusLocked: () => false,
    getGlobalEffectSlotActive: () => false,
    globalEffectSlotCount: 0,
    getLayerPlaylistLength: () => 0,
    getLayerActiveEntryIndex: () => -1,
    getWindowCursor: () => 0,
    windowSize: 6,
    getColorPaletteHue: () => null,
    syncOwnedKeys: new Set<string>(),
    ...over,
  };
}
