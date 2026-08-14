import { describe, expect, it } from 'vitest';

import { Colors } from '../constants/theme';

import {
  buildLiveTouchThemeMessage,
  canSendLiveTouchTheme,
  LIVE_TOUCH_THEME_KEYS,
  parseTouchControlBridgeMessage,
  resolveLiveTouchPanelUrl,
  resolvedThemeId,
  shouldSendLiveTouchThemeOnReady,
} from './live_touch_bridge';

describe('Live Touch host bridge', () => {
  it('resolves the simulation host from the CaptainPad origin and declares that exact origin', () => {
    expect(resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/',
      '/docs/ui/touch_control.html',
      '6969',
      'http://192.168.50.4:6967',
    )).toBe(
      'http://192.168.50.4:6969/docs/ui/touch_control.html?captainpad_origin=http%3A%2F%2F192.168.50.4%3A6967',
    );
  });

  it('keeps the configured engine host when no browser origin exists', () => {
    expect(resolveLiveTouchPanelUrl(
      'http://show-host.local:6968/',
      '/docs/ui/touch_control.html',
      '6969',
    )).toBe('http://show-host.local:6969/docs/ui/touch_control.html');
  });

  it('builds an exhaustive palette without leaking unrelated layout tokens', () => {
    const message = buildLiveTouchThemeMessage('theme-7', 'gruvbox', 'dark', Colors.gruvbox);

    expect(message.resolvedThemeId).toBe('gruvbox');
    expect(Object.keys(message.palette).sort()).toEqual([...LIVE_TOUCH_THEME_KEYS].sort());
    expect(message.palette.primary).toBe(Colors.gruvbox.primary);
    expect(message).not.toHaveProperty('palette.faderKnob');
  });

  it('resolves system to the actual rendered CaptainPad scheme', () => {
    expect(resolvedThemeId('system', 'light')).toBe('light');
    expect(resolvedThemeId('system', 'dark')).toBe('dark');
  });

  it('delivers theme after iframe load even if the child ready event was missed', () => {
    expect(canSendLiveTouchTheme(false)).toBe(false);
    expect(canSendLiveTouchTheme(true)).toBe(true);
    expect(shouldSendLiveTouchThemeOnReady(true, null)).toBe(true);
    expect(shouldSendLiveTouchThemeOnReady(true, 'theme-7')).toBe(false);
  });

  it('accepts only the versioned ready and correlated acknowledgement shapes', () => {
    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-theme-ready',
      version: 1,
    })).toEqual({ type: 'touch-control-theme-ready', version: 1 });

    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-theme-applied',
      version: 1,
      requestId: 'theme-8',
    })).toEqual({
      type: 'touch-control-theme-applied',
      version: 1,
      requestId: 'theme-8',
    });

    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-surface-released',
      version: 1,
      requestId: 'handoff-9',
      target: 'mixer',
    })).toEqual({
      type: 'touch-control-surface-released',
      version: 1,
      requestId: 'handoff-9',
      target: 'mixer',
    });
  });

  it('rejects malformed and unsupported child messages loudly', () => {
    expect(() => parseTouchControlBridgeMessage(null)).toThrow(/non-object/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'touch-control-theme-ready',
      version: 2,
    })).toThrow(/unsupported bridge version/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'touch-control-theme-applied',
      version: 1,
    })).toThrow(/missing requestId/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'surprise',
      version: 1,
    })).toThrow(/unknown bridge message/);
  });
});
