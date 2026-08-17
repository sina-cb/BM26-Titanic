import { describe, expect, it } from 'vitest';

import { Colors } from '../constants/theme';

import {
  buildLiveTouchThemeMessage,
  canDeliverToNativePanel,
  canSendLiveTouchTheme,
  handoffCurtainTarget,
  LIVE_TOUCH_EMBED_PARAM,
  LIVE_TOUCH_NATIVE_EMBED,
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

  // ── Native embed (report _252, docs/60 §4.2) ────────────────────────────

  it('marks the native embed and declares NO parent origin', () => {
    // On the iPad there is no web origin to declare — apiBase is already
    // metro-host-derived there — and inventing one would be a lie the page's
    // own origin check would then bless.
    expect(resolveLiveTouchPanelUrl(
      'http://192.168.50.4:6968/',
      '/docs/ui/touch_control.html',
      '6969',
      null,
      LIVE_TOUCH_NATIVE_EMBED,
    )).toBe(
      'http://192.168.50.4:6969/docs/ui/touch_control.html?captainpad_embed=native',
    );
  });

  it('keeps the two param names distinct and stable — the page reads both', () => {
    expect(LIVE_TOUCH_EMBED_PARAM).toBe('captainpad_embed');
    expect(LIVE_TOUCH_NATIVE_EMBED).toBe('native');
  });

  it('refuses to claim both a parent origin and a native embed', () => {
    expect(() => resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/',
      '/docs/ui/touch_control.html',
      '6969',
      'http://192.168.50.4:6967',
      LIVE_TOUCH_NATIVE_EMBED,
    )).toThrow(/both a parent origin and a native embed/);
  });

  it('leaves the web URL byte-identical when no embed mode is given', () => {
    const withoutArg = resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/', '/docs/ui/touch_control.html', '6969',
      'http://192.168.50.4:6967',
    );
    const withNull = resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/', '/docs/ui/touch_control.html', '6969',
      'http://192.168.50.4:6967', null,
    );
    expect(withNull).toBe(withoutArg);
    expect(withoutArg).not.toContain(LIVE_TOUCH_EMBED_PARAM);
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

  // ── The handoff curtain, and the native transport's honesty (report _257) ──

  it('curtains the pad for a navigation blend and never for a background release', () => {
    // The operator WATCHES a Live→Deck blend, so it gets the full-pad curtain.
    expect(handoffCurtainTarget('deck', 'navigation')).toBe('deck');
    expect(handoffCurtainTarget('mixer', 'navigation')).toBe('mixer');
    // Nobody is watching a background release — and on the iPad its
    // acknowledgement cannot arrive until the app is active again, so a curtain
    // here is exactly the "HANDING BACK TO DECK" panel the operator came back
    // to and could not dismiss.
    expect(handoffCurtainTarget('deck', 'background')).toBeNull();
    expect(handoffCurtainTarget('mixer', 'background')).toBeNull();
  });

  it('refuses to guess what an unknown handoff reason should curtain', () => {
    expect(() => handoffCurtainTarget(
      'deck',
      'whenever' as unknown as 'navigation',
    )).toThrow(/unsupported reason/);
  });

  it('claims native delivery only while the panel hook actually exists', () => {
    // `injectJavaScript` reports nothing, so the surface answers from the
    // panel's own readiness. A mounted WebView whose page has not installed
    // (or has just reloaded away) `window.__captainpadDeliver` cannot receive.
    expect(canDeliverToNativePanel(true, true)).toBe(true);
    expect(canDeliverToNativePanel(true, false)).toBe(false);
    expect(canDeliverToNativePanel(false, true)).toBe(false);
    expect(canDeliverToNativePanel(false, false)).toBe(false);
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

    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-spatial-fullscreen',
      version: 1,
      requestId: 'fullscreen-10',
      active: true,
    })).toEqual({
      type: 'touch-control-spatial-fullscreen',
      version: 1,
      requestId: 'fullscreen-10',
      active: true,
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
      type: 'touch-control-spatial-fullscreen',
      version: 1,
      requestId: 'fullscreen-11',
      active: 'yes',
    })).toThrow(/invalid active state/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'surprise',
      version: 1,
    })).toThrow(/unknown bridge message/);
  });
});
