import { describe, expect, it } from 'vitest';

import {
  destinationActivationDecision,
  layerSettingsRequireLiveHandoff,
  layerDestinationForNavigationAction,
  layerDestinationForNavigationState,
  layerSettingForRoute,
  mixerFocusMayActivate,
  parseLayerSettingsState,
} from './layer_settings';

describe('layer settings contract', () => {
  it('parses the authoritative steady state', () => {
    expect(parseLayerSettingsState({
      type: 'layerSettings',
      active: 'deck',
      target: 'deck',
      transition: null,
      queued: null,
      liveTouch: { armed: false, ownerId: null, ready: false, pattern: null },
    })).toEqual({
      type: 'layerSettings',
      active: 'deck',
      target: 'deck',
      transition: null,
      queued: null,
      liveTouch: { armed: false, ownerId: null, ready: false, pattern: null },
    });
  });

  it('parses the canonical linear two-setting transition and queued latest intent', () => {
    const state = parseLayerSettingsState({
      type: 'layerSettings',
      active: 'deck',
      target: 'live_touch',
      transition: {
        id: 'layer-transition-3',
        from: 'deck',
        to: 'live_touch',
        progress: 0.25,
        durationMs: 1000,
        curve: 'linear',
      },
      queued: 'mixer',
      liveTouch: {
        armed: true, ownerId: 'touch-control-7', ready: true, pattern: '130_spatial_paint',
      },
    });

    expect(state.transition?.to).toBe('live_touch');
    expect(state.queued).toBe('mixer');
  });

  it('rejects unknown settings, malformed progress, and unversioned shapes', () => {
    const base = {
      type: 'layerSettings',
      active: 'deck',
      target: 'deck',
      transition: null,
      queued: null,
      liveTouch: { armed: false, ownerId: null, ready: false, pattern: null },
    };

    expect(() => parseLayerSettingsState({ ...base, active: 'other' })).toThrow(/active is invalid/);
    expect(() => parseLayerSettingsState({
      ...base,
      transition: {
        id: 'bad', from: 'deck', to: 'mixer', progress: 2, durationMs: 1000, curve: 'linear',
      },
    })).toThrow(/transition.progress/);
    expect(() => parseLayerSettingsState({ ...base, type: undefined })).toThrow(/type is invalid/);
  });

  it('maps only the three canonical Layers routes', () => {
    expect(layerSettingForRoute('index')).toBe('deck');
    expect(layerSettingForRoute('mixer')).toBe('mixer');
    expect(layerSettingForRoute('touch_control')).toBe('live_touch');
    expect(layerSettingForRoute('config')).toBeNull();
  });

  it('returns a layer destination only for explicit Deck or Mixer navigation', () => {
    expect(layerDestinationForNavigationAction({ payload: { name: 'mixer' } })).toBe('mixer');
    expect(layerDestinationForNavigationAction({ payload: { params: { screen: 'mixer' } } })).toBe('mixer');
    expect(layerDestinationForNavigationAction({ payload: { name: 'index' } })).toBe('deck');
    expect(layerDestinationForNavigationAction({ payload: { name: 'config' } })).toBeNull();
    expect(layerDestinationForNavigationAction({ payload: { name: 'audio' } })).toBeNull();
    expect(layerDestinationForNavigationAction(null)).toBeNull();
  });

  it('derives a deep-linked destination from the active navigation route', () => {
    expect(layerDestinationForNavigationState({
      index: 2,
      routes: [{ name: 'index' }, { name: 'touch_control' }, { name: 'mixer' }],
    })).toBe('mixer');
    expect(layerDestinationForNavigationState({
      index: 0,
      routes: [{ name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'mixer' }] } }],
    })).toBe('mixer');
    expect(layerDestinationForNavigationState({ index: 0, routes: [{ name: 'index' }] })).toBe('deck');
    expect(layerDestinationForNavigationState({ index: 0, routes: [{ name: 'config' }] })).toBeNull();
    expect(layerDestinationForNavigationState({ index: 4, routes: [{ name: 'mixer' }] })).toBeNull();
  });

  it('requires a serialized handoff whenever Live owns or participates in output', () => {
    const steadyDeck = parseLayerSettingsState({
      type: 'layerSettings',
      active: 'deck',
      target: 'deck',
      transition: null,
      queued: null,
      liveTouch: { armed: false, ownerId: null, ready: false, pattern: null },
    });
    expect(layerSettingsRequireLiveHandoff(steadyDeck)).toBe(false);
    expect(layerSettingsRequireLiveHandoff({
      ...steadyDeck,
      liveTouch: { ...steadyDeck.liveTouch, armed: true, ownerId: 'live-owner' },
    })).toBe(true);
    expect(layerSettingsRequireLiveHandoff({
      ...steadyDeck,
      active: 'live_touch',
      target: 'deck',
      transition: {
        id: 'handoff-1',
        from: 'live_touch',
        to: 'deck',
        progress: 0.5,
        durationMs: 1000,
        curve: 'linear',
      },
    })).toBe(true);
  });

  it('keeps Mixer focus plan-gated but permits an existing operator takeover lease', () => {
    expect(mixerFocusMayActivate(false, false)).toBe(true);
    expect(mixerFocusMayActivate(false, true)).toBe(true);
    expect(mixerFocusMayActivate(true, false)).toBe(false);
    expect(mixerFocusMayActivate(true, true)).toBe(true);
  });

  it('serializes destination focus behind Live handoff and suppresses stale focus', () => {
    expect(destinationActivationDecision('deck', 'deck', null, 10)).toBe('wait');
    expect(destinationActivationDecision('deck', 'mixer', null, 10)).toBe('supersede');
    expect(destinationActivationDecision(
      'deck', null, { target: 'deck', completedAtMs: 10 }, 11,
    )).toBe('skip');
    expect(destinationActivationDecision(
      'deck', null, { target: 'deck', completedAtMs: 10 }, 2_000,
    )).toBe('activate');
    expect(destinationActivationDecision('deck', null, null, 10)).toBe('activate');
  });
});
