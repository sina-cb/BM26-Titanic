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
    const ctx = { ...baseCtx, getLayer: (l: number) => (l === 0 ? { id: 'ch_a', role: 'mixer' as const, solo: false } : null) };
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 0, value: 0.5 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch_a', { fader: 0.5 });
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 2, value: 0.9 });
    expect(api.updateMixerChannel).toHaveBeenCalledTimes(1); // layer 2 absent → no-op
  });

  it('mixerLayerFader on the deck channel uses the deck API', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getLayer: () => ({ id: 'deck', role: 'deck' as const, solo: false }) };
    await createDispatcher(api, ctx)({ kind: 'mixerLayerFader', layer: 0, value: 0.4 });
    expect(api.updateDeckChannel).toHaveBeenCalledWith({ fader: 0.4 });
    expect(api.updateMixerChannel).not.toHaveBeenCalled();
  });

  it('mixerLayerSolo flips solo on the Nth mixer channel (no-op on deck)', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getLayer: () => ({ id: 'ch_a', role: 'mixer' as const, solo: false }) };
    await createDispatcher(api, ctx)({ kind: 'mixerLayerSolo', layer: 0 });
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch_a', { solo: true });
    const api2 = makeApi();
    const deckCtx = { ...baseCtx, getLayer: () => ({ id: 'deck', role: 'deck' as const, solo: false }) };
    await createDispatcher(api2, deckCtx)({ kind: 'mixerLayerSolo', layer: 0 });
    expect(api2.updateMixerChannel).not.toHaveBeenCalled();
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
});
