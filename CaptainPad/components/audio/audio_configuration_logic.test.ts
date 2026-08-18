import { describe, expect, it } from 'vitest';

import {
  audioPageLayout,
  audioRouteBodyState,
  paramCenterWriteError,
  paramValueMatches,
  parseAudioConfig,
} from './audio_configuration_logic';

const CONFIG = {
  enabled: true,
  capture: {
    backend: 'ffmpeg',
    device: 'audio=USB Mic',
    sampleRate: 48000,
    channels: 2,
    inputFormat: 'dshow',
  },
  fftSize: 2048,
  hopSize: 1024,
  bands: {
    lowMaxHz: 180,
    midMaxHz: 2200,
    attackMs: 25,
    releaseMs: 180,
    noiseGate: 0.04,
    inputGain: 1.5,
  },
  kick: {
    minHz: 45,
    maxHz: 140,
    threshold: 1.5,
    refractoryMs: 120,
    decayMs: 180,
  },
};

describe('audio page responsive layout', () => {
  it.each([
    [1440, { routeWidth: 1328, pagePadding: 32, meterColumns: 3, stackBpmControls: false }],
    [1180, { routeWidth: 1068, pagePadding: 32, meterColumns: 3, stackBpmControls: false }],
    [568, { routeWidth: 456, pagePadding: 16, meterColumns: 2, stackBpmControls: false }],
    [430, { routeWidth: 318, pagePadding: 16, meterColumns: 1, stackBpmControls: true }],
  ])('maps %ipx to a deterministic native/web layout', (width, expected) => {
    expect(audioPageLayout(width as number)).toEqual(expected);
  });

  it('fails loudly when the CaptainPad rail leaves no content width', () => {
    expect(() => audioPageLayout(112)).toThrow('window wider than 112px');
  });
});

describe('Audio native route body state', () => {
  it('mounts content for authoritative Edit and offline Edit views', () => {
    expect(audioRouteBodyState({
      performanceModeReady: true, globalPerformanceActive: false, engineOffline: false,
    })).toBe('content');
    expect(audioRouteBodyState({
      performanceModeReady: false, globalPerformanceActive: false, engineOffline: true,
    })).toBe('content');
  });

  it('renders a loud body instead of null while online authority is unresolved', () => {
    expect(audioRouteBodyState({
      performanceModeReady: false, globalPerformanceActive: false, engineOffline: false,
    })).toBe('authority_pending');
  });

  it('redirects a stale/deep-linked Performance route', () => {
    expect(audioRouteBodyState({
      performanceModeReady: true, globalPerformanceActive: true, engineOffline: false,
    })).toBe('redirect');
  });
});

describe('audio config readback validation', () => {
  it('accepts the engine full-config response', () => {
    expect(parseAudioConfig(CONFIG).bands.inputGain).toBe(1.5);
  });

  it.each([
    [{ ...CONFIG, fftSize: '2048' }, 'fftSize'],
    [{ ...CONFIG, capture: { ...CONFIG.capture, device: 42 } }, 'capture.device'],
    [{ ...CONFIG, bands: { ...CONFIG.bands, inputGain: Number.NaN } }, 'inputGain'],
  ])('rejects malformed engine truth instead of rendering it', (value, field) => {
    expect(() => parseAudioConfig(value)).toThrow(field as string);
  });
});

describe('param-center save/readback outcomes', () => {
  it('accepts a complete write response', () => {
    expect(paramCenterWriteError({ ok: true, data: { status: 'ok', revision: 4 } }, 'bpmSpeedMin')).toBeNull();
  });

  it('surfaces a source-lock refusal from a partial response', () => {
    expect(paramCenterWriteError({
      ok: true,
      data: { status: 'partial', ignored: [{ key: 'bpmSpeedMin', reason: 'locked by live touch' }] },
    }, 'bpmSpeedMin')).toBe('bpmSpeedMin: locked by live touch');
  });

  it('rejects malformed success bodies', () => {
    expect(paramCenterWriteError({ ok: true, data: {} }, 'bpmSpeedSync'))
      .toBe('param-center returned an invalid status for bpmSpeedSync');
  });

  it('matches authoritative numeric readback without loose rounding', () => {
    expect(paramValueMatches(70, 70)).toBe(true);
    expect(paramValueMatches(70.01, 70)).toBe(false);
    expect(paramValueMatches(undefined, 70)).toBe(false);
  });
});
