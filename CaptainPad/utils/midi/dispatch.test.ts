import { describe, it, expect, vi } from 'vitest';
import { createDispatcher, MidiDispatchApi, MidiDispatchContext } from './dispatch';

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok),
    updateMixerMaster: vi.fn(ok),
    setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok),
    setGlobalEffect: vi.fn(ok),
    setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok),
    updateMixerChannel: vi.fn(ok),
    updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok),
    setGlobalEffectBlackout: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok),
    setMixerChannelControl: vi.fn(ok),
  };
}

const baseCtx: MidiDispatchContext = {
  getBlackout: () => false,
  getGlobalEffectState: () => false,
  resolvePatternForBank: () => null,
  getLayer: () => null,
  getColorPalette: () => null,
};

describe('createDispatcher', () => {
  it('paramCenter → updateParamCenter({ key: value })', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'paramCenter', key: 'speed', value: 0.5 });
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: 0.5 });
  });

  it('master → updateMixerMaster(value)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'master', value: 0.75 });
    expect(api.updateMixerMaster).toHaveBeenCalledWith(0.75);
  });

  it('blackoutToggle flips the current blackout via the GEM e-stop', async () => {
    const api = makeApi();
    await createDispatcher(api, { ...baseCtx, getBlackout: () => false })({ kind: 'blackoutToggle' });
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledWith(true);
    const api2 = makeApi();
    await createDispatcher(api2, { ...baseCtx, getBlackout: () => true })({ kind: 'blackoutToggle' });
    expect(api2.setGlobalEffectBlackout).toHaveBeenCalledWith(false);
  });

  it('mixerLayerFader writes the Nth mixer channel fader (inert if absent)', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getLayer: (l: number) => (l === 0 ? { id: 'ch_a', role: 'mixer' as const } : null) };
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 0, value: 0.5 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch_a', { fader: 0.5 });
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 2, value: 0.9 });
    expect(api.updateMixerChannel).toHaveBeenCalledTimes(1); // layer 2 absent → no-op
  });

  it('mixerLayerFader on the deck channel uses the deck API', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getLayer: () => ({ id: 'deck', role: 'deck' as const }) };
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 0, value: 0.4 });
    expect(api.updateDeckChannel).toHaveBeenCalledWith({ fader: 0.4 });
    expect(api.updateMixerChannel).not.toHaveBeenCalled();
  });

  it('runtime-only actions (focusChannel/scroll/window) THROW in the dispatcher', async () => {
    const api = makeApi();
    // These must be intercepted by the controller runtime; reaching the
    // dispatcher is a wiring bug, so it fails loud rather than silently.
    await expect(createDispatcher(api, baseCtx)({ kind: 'focusChannel', layer: 1 })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'playlistScroll', layer: 0, dir: 'up' })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'playlistWindowSelect', layer: 0, slot: 0 })).rejects.toThrow(/controller runtime/);
  });

  it('globalEffectSlot toggles the slot', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'globalEffectSlot', slot: 3 });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(3, 'toggle');
  });

  it('colorPalettePair applies the curated pair as HSV', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getColorPalette: (i: number) => (i === 2 ? { c1: 0.1, c2: 0.6 } : null) };
    await createDispatcher(api, ctx)({ kind: 'colorPalettePair', palette: 2 });
    expect(api.updateParamCenter).toHaveBeenCalledWith({
      colorPalette1: { h: 0.1, s: 1, v: 1 },
      colorPalette2: { h: 0.6, s: 1, v: 1 },
    });
  });

  it('colorPalettePair with no palette behind the pad is a no-op', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'colorPalettePair', palette: 99 });
    expect(api.updateParamCenter).not.toHaveBeenCalled();
  });

  it('globalEffect flips the current effect state', async () => {
    const api = makeApi();
    await createDispatcher(api, { ...baseCtx, getGlobalEffectState: () => true })({ kind: 'globalEffect', effect: 'strobe' });
    expect(api.setGlobalEffect).toHaveBeenCalledWith('strobe', false);
  });

  it('patternBank resolves the pad to a pattern name', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, resolvePatternForBank: (b: number, i: number) => `bank${b}_pad${i}` };
    await createDispatcher(api, ctx)({ kind: 'patternBank', bank: 0, index: 2 });
    expect(api.setActivePattern).toHaveBeenCalledWith('bank0_pad2');
  });

  it('patternBank dispatches NOTHING for an empty pad', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'patternBank', bank: 0, index: 99 });
    expect(api.setActivePattern).not.toHaveBeenCalled();
  });

  it('sectionBrightness → setSectionBrightness(id, value)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'sectionBrightness', sectionId: 3, value: 0.4 });
    expect(api.setSectionBrightness).toHaveBeenCalledWith(3, 0.4);
  });

  it('localParam (deck role) → setDeckChannelControl(exportId, value)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'localParam', role: 'deck', channelId: 'deck1', exportId: 5, value: 0.7 });
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, 0.7);
    expect(api.setMixerChannelControl).not.toHaveBeenCalled();
  });

  it('localParam (mixer role) → setMixerChannelControl(channelId, exportId, value)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'localParam', role: 'mixer', channelId: 'ch_b', exportId: 9, value: 0.3 });
    expect(api.setMixerChannelControl).toHaveBeenCalledWith('ch_b', 9, 0.3);
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

});
