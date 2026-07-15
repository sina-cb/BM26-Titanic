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
    setGlobalEffectSlotIntensity: vi.fn(ok),
    resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok),
    cycleGlobalEffectSlotMode: vi.fn(ok),
    nextEffectBank: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok),
    disableAllGlobalEffects: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok),
    setMixerChannelControl: vi.fn(ok),
    setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok),
    toggleCombinedAutopilot: vi.fn(ok),
    toggleMasterFade: vi.fn(ok), summonPerformanceDialog: vi.fn(ok),
  };
}

const baseCtx: MidiDispatchContext = {
  getBlackout: () => false,
  getGlobalEffectState: () => false,
  resolvePatternForBank: () => null,
  getLayer: () => null,
  getColorPalette: () => null,
  getBpmSpeedSyncOn: () => false,
  // Default: slot not in the snapshot (returns null) → dispatcher fails safe to
  // 'toggle'. Behavior-specific tests override this per slot.
  getGlobalEffectSlotBehavior: () => null,
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

  it('runtime-only actions (focusChannel/scroll/window/hue delta+reset) THROW in the dispatcher', async () => {
    const api = makeApi();
    // These must be intercepted by the controller runtime; reaching the
    // dispatcher is a wiring bug, so it fails loud rather than silently.
    await expect(createDispatcher(api, baseCtx)({ kind: 'focusChannel', layer: 1 })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'playlistScroll', layer: 0, dir: 'up' })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'playlistWindowSelect', layer: 0, slot: 0 })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'hueDelta', delta: 0.1 })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'hueReset' })).rejects.toThrow(/controller runtime/);
  });

  // ── MFT UX v2: BPM→Speed sync toggle + per-channel hue write ──
  it('bpmSyncToggle flips the live sync state via updateParamCenter({ bpmSpeedSync })', async () => {
    const api = makeApi();
    await createDispatcher(api, { ...baseCtx, getBpmSpeedSyncOn: () => false })({ kind: 'bpmSyncToggle' });
    expect(api.updateParamCenter).toHaveBeenCalledWith({ bpmSpeedSync: 1 });
    const api2 = makeApi();
    await createDispatcher(api2, { ...baseCtx, getBpmSpeedSyncOn: () => true })({ kind: 'bpmSyncToggle' });
    expect(api2.updateParamCenter).toHaveBeenCalledWith({ bpmSpeedSync: 0 });
  });

  it('bpmSyncToggle double-press on a LAGGING snapshot still toggles (P3-1 pattern)', async () => {
    const api = makeApi();
    // Snapshot frozen at false — the sharedParams echo hasn't landed.
    const dispatch = createDispatcher(api, { ...baseCtx, getBpmSpeedSyncOn: () => false });
    await dispatch({ kind: 'bpmSyncToggle' }); // false → sends 1
    await dispatch({ kind: 'bpmSyncToggle' }); // stale false, but last-sent true → sends 0
    const calls = (api.updateParamCenter as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([{ bpmSpeedSync: 1 }, { bpmSpeedSync: 0 }]);
  });

  // ── Per-CHANNEL hue knob: the hue knob's ONLY engine write (the global hue
  //    shifter — setGlobalHue and its autoRotate field — was removed 2026-07).
  //    Both contexts target a channel: deck tab → the deck channel, mixer tab →
  //    the focused overlay. ──
  it('channelHue on a mixer channel PATCHes that channel (no deck flag, no autoRotate)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'channelHue', role: 'mixer', channelId: 'ch_a', degrees: 120 });
    expect(api.setChannelHue).toHaveBeenCalledWith('ch_a', 120, undefined);
  });

  it('channelHue on the deck channel routes with { deck: true }', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'channelHue', role: 'deck', channelId: 'd1', degrees: 45 });
    expect(api.setChannelHue).toHaveBeenCalledWith('d1', 45, { deck: true });
  });

  // ── Behavior-aware global-effect slot dispatch (Iceberg-Flash / White-Drop) ──
  it('globalEffectSlot with a TOGGLE behavior dispatches toggle', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getGlobalEffectSlotBehavior: () => 'toggle' as const };
    await createDispatcher(api, ctx)({ kind: 'globalEffectSlot', slot: 3 });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(3, 'toggle');
  });

  it('globalEffectSlot with a TRIGGER behavior dispatches trigger (the Iceberg-Flash fix)', async () => {
    const api = makeApi();
    // Slot 5 = Iceberg Flash, behavior 'trigger'. The old hardcoded 'toggle'
    // never fired it; now it must dispatch 'trigger'.
    const ctx = { ...baseCtx, getGlobalEffectSlotBehavior: () => 'trigger' as const };
    await createDispatcher(api, ctx)({ kind: 'globalEffectSlot', slot: 5 });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(5, 'trigger');
  });

  it('globalEffectSlot with an UNKNOWN/absent behavior FAILS SAFE to toggle (no crash)', async () => {
    const api = makeApi();
    // baseCtx returns null (slot not in the snapshot — a boot/refresh race).
    const r = await createDispatcher(api, baseCtx)({ kind: 'globalEffectSlot', slot: 2 });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
    expect(r).toEqual({ ok: true });
  });

  it('globalEffectSlot with a HOLD behavior dispatches down on press and up on release', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getGlobalEffectSlotBehavior: () => 'hold' as const };
    await createDispatcher(api, ctx)({ kind: 'globalEffectSlot', slot: 4, phase: 'press' });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(4, 'down');
    await createDispatcher(api, ctx)({ kind: 'globalEffectSlot', slot: 4, phase: 'release' });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(4, 'up');
  });

  it('globalEffectSlot defaults to the PRESS phase when none is given (hold → down)', async () => {
    const api = makeApi();
    const ctx = { ...baseCtx, getGlobalEffectSlotBehavior: () => 'hold' as const };
    await createDispatcher(api, ctx)({ kind: 'globalEffectSlot', slot: 4 });
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(4, 'down');
  });

  // ── APC operator re-layout (2026-07): the three new button kinds route to
  //    the injected api methods (the read/decision lives in the impl). ──
  it('viewToggle → toggleDeckMixerView()', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'viewToggle' });
    expect(api.toggleDeckMixerView).toHaveBeenCalledTimes(1);
  });

  it('autopilotToggle → toggleCombinedAutopilot()', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'autopilotToggle' });
    expect(api.toggleCombinedAutopilot).toHaveBeenCalledTimes(1);
  });

  it('masterFadeToggle → toggleMasterFade()', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'masterFadeToggle' });
    expect(api.toggleMasterFade).toHaveBeenCalledTimes(1);
  });

  it('the three new toggles THREAD the api result (fail-loud)', async () => {
    const api = makeApi();
    (api.toggleCombinedAutopilot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'read failed' });
    const r = await createDispatcher(api, baseCtx)({ kind: 'autopilotToggle' });
    expect(r).toEqual({ ok: false, error: 'read failed' });
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

  // ── P2-5: the dispatcher THREADS the api's MidiApiResult back (fail-loud) ──
  it('P2-5 returns the api result (ok:false with error) instead of discarding it', async () => {
    const api = makeApi();
    (api.updateParamCenter as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'engine 404' });
    const r = await createDispatcher(api, baseCtx)({ kind: 'paramCenter', key: 'speed', value: 0.5 });
    expect(r).toEqual({ ok: false, error: 'engine 404' });
  });

  it('P2-5 returns ok:true for a real engine call', async () => {
    const api = makeApi();
    const r = await createDispatcher(api, baseCtx)({ kind: 'master', value: 0.5 });
    expect(r).toEqual({ ok: true });
  });

  it('P2-5 a deliberate no-op (empty pad) is a SUCCESS, not a failure', async () => {
    const api = makeApi();
    // resolvePatternForBank returns null → nothing behind the pad → OK, not a fail.
    const r = await createDispatcher(api, baseCtx)({ kind: 'patternBank', bank: 0, index: 99 });
    expect(r).toEqual({ ok: true });
    expect(api.setActivePattern).not.toHaveBeenCalled();
  });

  // ── P3-1: a blackout panic double-tap inside the echo window toggles ──
  it('P3-1 a double-tap on the LAGGING snapshot still toggles (does not stick ON)', async () => {
    const api = makeApi();
    // The snapshot is FROZEN at false the whole time (the echo hasn't landed).
    const dispatch = createDispatcher(api, { ...baseCtx, getBlackout: () => false });
    await dispatch({ kind: 'blackoutToggle' }); // false → sends true
    await dispatch({ kind: 'blackoutToggle' }); // stale snapshot still false, but last-sent true → sends false
    const calls = (api.setGlobalEffectBlackout as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([true, false]); // actually toggled, not [true, true]
  });

  it('P3-1 trusts the snapshot again once its echo catches up', async () => {
    const api = makeApi();
    let bo = false;
    const dispatch = createDispatcher(api, { ...baseCtx, getBlackout: () => bo });
    await dispatch({ kind: 'blackoutToggle' }); // false → true (lastSent = true)
    bo = true; // echo landed: snapshot now matches lastSent
    await dispatch({ kind: 'blackoutToggle' }); // snapshot true → sends false
    const calls = (api.setGlobalEffectBlackout as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([true, false]);
  });

});
