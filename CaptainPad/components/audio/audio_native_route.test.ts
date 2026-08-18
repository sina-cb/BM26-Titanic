import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canMountCaptainPadRoute, isCaptainPadTabVisible } from '../../utils/captainpad_tab_policy';
import { audioPageLayout, audioRouteBodyState } from './audio_configuration_logic';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTAINPAD = join(HERE, '..', '..');
const AUDIO_ROUTE = readFileSync(join(CAPTAINPAD, 'app', '(tabs)', 'audio.tsx'), 'utf8');
const TAB_LAYOUT = readFileSync(join(CAPTAINPAD, 'app', '(tabs)', '_layout.tsx'), 'utf8');
const APP_CONFIG = JSON.parse(readFileSync(join(CAPTAINPAD, 'app.json'), 'utf8'));

describe('Audio native iPad route contract', () => {
  it('registers a real Expo Router tab whose module fails loudly if imports are missing', () => {
    expect(TAB_LAYOUT).toMatch(/<Tabs\.Screen\s+name="audio"/);
    expect(TAB_LAYOUT).toContain("options={captainPadTabOptions('audio') as any}");
    expect(AUDIO_ROUTE).toContain('export default function AudioAnalysisScreen()');
    expect(AUDIO_ROUTE).toContain('const bodyState = audioRouteBodyState({');
    expect(AUDIO_ROUTE).not.toMatch(/try\s*\{\s*(?:require|import)\(/);
  });

  it('mounts Audio in Edit and preserves the existing Performance exclusion', () => {
    expect(isCaptainPadTabVisible('audio', false)).toBe(true);
    expect(canMountCaptainPadRoute('audio', false)).toBe(true);
    expect(isCaptainPadTabVisible('audio', true)).toBe(false);
    expect(canMountCaptainPadRoute('audio', true)).toBe(false);
    expect(audioRouteBodyState({
      performanceModeReady: true, globalPerformanceActive: false, engineOffline: false,
    })).toBe('content');
    expect(audioRouteBodyState({
      performanceModeReady: true, globalPerformanceActive: true, engineOffline: false,
    })).toBe('redirect');
  });

  it('exposes stable native mount probes and never blanks while authority/config load', () => {
    expect(AUDIO_ROUTE).toContain('testID="audio-analysis-screen"');
    expect(AUDIO_ROUTE).toContain('testID="audio-primary-controls"');
    expect(AUDIO_ROUTE).toContain('CHECKING EDIT AUTHORITY');
    expect(AUDIO_ROUTE).toContain('AUDIO CONFIG UNAVAILABLE');
    expect(AUDIO_ROUTE).toContain('Loading audio config');
    expect(audioRouteBodyState({
      performanceModeReady: false, globalPerformanceActive: false, engineOffline: false,
    })).toBe('authority_pending');
  });

  it('mounts every required Edit configuration section after the live monitor', () => {
    const monitor = AUDIO_ROUTE.indexOf('testID="audio-primary-controls"');
    const bpmSync = AUDIO_ROUTE.indexOf('testID="audio-bpm-sync"');
    const companion = AUDIO_ROUTE.indexOf('testID="audio-companion-card"');
    const settings = AUDIO_ROUTE.indexOf('testID="audio-settings-card"');
    expect(monitor).toBeGreaterThan(-1);
    expect(bpmSync).toBeGreaterThan(monitor);
    expect(companion).toBeGreaterThan(bpmSync);
    expect(settings).toBeGreaterThan(companion);
  });

  it('uses the Fabric-enabled, full-screen landscape iPad bundle contract', () => {
    expect(APP_CONFIG.expo.newArchEnabled).toBe(true);
    expect(APP_CONFIG.expo.orientation).toBe('landscape');
    expect(APP_CONFIG.expo.ios.supportsTablet).toBe(true);
    expect(APP_CONFIG.expo.ios.requireFullScreen).toBe(true);
  });

  it.each([
    [1024, 3],
    [1180, 3],
    [1194, 3],
  ])('keeps primary controls on-screen at native iPad width %ipx', (width, columns) => {
    const layout = audioPageLayout(width);
    expect(layout.routeWidth).toBe(width - 112);
    expect(layout.meterColumns).toBe(columns);
    expect(layout.routeWidth - layout.pagePadding * 2).toBeGreaterThanOrEqual(720);
  });
});
