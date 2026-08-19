import { describe, expect, it } from 'vitest';

import { Colors } from '../constants/theme';

import {
  buildLiveTouchThemeMessage,
  canDeliverToNativePanel,
  canSendLiveTouchTheme,
  handoffCurtainTarget,
  LIVE_TOUCH_ENGINE_ORIGIN_PARAM,
  LIVE_TOUCH_EMBED_PARAM,
  LIVE_TOUCH_NATIVE_EMBED,
  LIVE_TOUCH_PROTOCOL_PARAM,
  LIVE_TOUCH_PROTOCOL_VERSION,
  LIVE_TOUCH_THEME_KEYS,
  nativePanelDocumentUrl,
  parseTouchControlBridgeMessage,
  resolveLiveTouchPanelUrl,
  resolvedThemeId,
  shouldSendLiveTouchThemeOnReady,
  validateLiveTouchPanelUrl,
} from './live_touch_bridge';

describe('Live Touch host bridge', () => {
  it('resolves the simulation host from the CaptainPad origin and declares that exact origin', () => {
    expect(resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
      'http://192.0.2.4:6967',
    )).toBe(
      'http://192.0.2.4:6969/CaptainPad/live_touch/touch_control.html'
      + '?captainpad_origin=http%3A%2F%2F192.0.2.4%3A6967'
      + '&captainpad_engine_origin=http%3A%2F%2F127.0.0.1%3A6968'
      + '&captainpad_live_touch_protocol=2',
    );
  });

  it('keeps and declares the configured engine origin when no browser origin exists', () => {
    expect(resolveLiveTouchPanelUrl(
      'http://show-host.local:6968/',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
    )).toBe(
      'http://show-host.local:6969/CaptainPad/live_touch/touch_control.html'
      + '?captainpad_engine_origin=http%3A%2F%2Fshow-host.local%3A6968'
      + '&captainpad_live_touch_protocol=2',
    );
  });

  // ── Native embed (report _252, docs/60 §4.2) ────────────────────────────

  it('marks the native embed and declares NO parent origin', () => {
    // On the iPad there is no web origin to declare — apiBase is already
    // metro-host-derived there — and inventing one would be a lie the page's
    // own origin check would then bless.
    expect(resolveLiveTouchPanelUrl(
      'http://192.0.2.4:6968/',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
      null,
      LIVE_TOUCH_NATIVE_EMBED,
    )).toBe(
      'http://192.0.2.4:6969/CaptainPad/live_touch/touch_control.html'
      + '?captainpad_embed=native'
      + '&captainpad_engine_origin=http%3A%2F%2F192.0.2.4%3A6968'
      + '&captainpad_live_touch_protocol=2',
    );
  });

  it('keeps the two param names distinct and stable — the page reads both', () => {
    expect(LIVE_TOUCH_EMBED_PARAM).toBe('captainpad_embed');
    expect(LIVE_TOUCH_NATIVE_EMBED).toBe('native');
    expect(LIVE_TOUCH_ENGINE_ORIGIN_PARAM).toBe('captainpad_engine_origin');
    expect(LIVE_TOUCH_PROTOCOL_PARAM).toBe('captainpad_live_touch_protocol');
    expect(LIVE_TOUCH_PROTOCOL_VERSION).toBe(2);
  });

  it('refuses to claim both a parent origin and a native embed', () => {
    expect(() => resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
      'http://192.0.2.4:6967',
      LIVE_TOUCH_NATIVE_EMBED,
    )).toThrow(/both a parent origin and a native embed/);
  });

  it('leaves the web URL byte-identical when no embed mode is given', () => {
    const withoutArg = resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/', '/CaptainPad/live_touch/touch_control.html', '6969',
      'http://192.0.2.4:6967',
    );
    const withNull = resolveLiveTouchPanelUrl(
      'http://127.0.0.1:6968/', '/CaptainPad/live_touch/touch_control.html', '6969',
      'http://192.0.2.4:6967', null,
    );
    expect(withNull).toBe(withoutArg);
    expect(withoutArg).not.toContain(LIVE_TOUCH_EMBED_PARAM);
  });

  it('encodes the exact resolved API origin independently from the web panel host', () => {
    const resolved = resolveLiveTouchPanelUrl(
      'https://[2001:db8::7]:7443/api?ignored=true',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
      'https://captainpad.example:6967',
    );
    expect(resolved).toBe(
      'https://captainpad.example:6969/CaptainPad/live_touch/touch_control.html'
      + '?captainpad_origin=https%3A%2F%2Fcaptainpad.example%3A6967'
      + '&captainpad_engine_origin=https%3A%2F%2F%5B2001%3Adb8%3A%3A7%5D%3A7443'
      + '&captainpad_live_touch_protocol=2',
    );
  });

  it('rejects malformed or non-http endpoint inputs instead of guessing', () => {
    expect(() => resolveLiveTouchPanelUrl(
      'http://[', '/CaptainPad/live_touch/touch_control.html', '6969',
    )).toThrow(/API base is not a valid URL/);
    expect(() => resolveLiveTouchPanelUrl(
      'ws://show-host.local:6968', '/CaptainPad/live_touch/touch_control.html', '6969',
    )).toThrow(/API base must use http or https/);
    expect(() => resolveLiveTouchPanelUrl(
      'http://show-host.local:6968', '/CaptainPad/live_touch/touch_control.html', '6969',
      'file:///captainpad',
    )).toThrow(/parent origin must use http or https/);
    expect(() => resolveLiveTouchPanelUrl(
      'http://show-host.local:6968', '/CaptainPad/live_touch/touch_control.html', 'not-a-port',
    )).toThrow(/simulation port must be a decimal integer/);
  });

  it('rejects missing, duplicate, malformed, and mismatched URL endpoint contracts', () => {
    const expected = 'http://show-host.local:6968';
    const base = 'http://show-host.local:6969/CaptainPad/live_touch/touch_control.html';
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_live_touch_protocol=2`, expected,
    )).toThrow(/missing engine origin/);
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_engine_origin=${encodeURIComponent(expected)}`, expected,
    )).toThrow(/missing protocol version/);
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_engine_origin=${encodeURIComponent(expected)}`
      + '&captainpad_live_touch_protocol=1',
      expected,
    )).toThrow(/protocol mismatch/);
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_engine_origin=${encodeURIComponent('http://other.local:6968')}`
      + '&captainpad_live_touch_protocol=2',
      expected,
    )).toThrow(/engine origin mismatch/);
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_engine_origin=${encodeURIComponent(`${expected}/api`)}`
      + '&captainpad_live_touch_protocol=2',
      expected,
    )).toThrow(/must be an exact origin/);
    expect(() => validateLiveTouchPanelUrl(
      `${base}?captainpad_engine_origin=${encodeURIComponent(expected)}`
      + `&captainpad_engine_origin=${encodeURIComponent(expected)}`
      + '&captainpad_live_touch_protocol=2',
      expected,
    )).toThrow(/multiple engine origin values/);
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

  it('gives each native document a distinct cache-proof URL', () => {
    expect(nativePanelDocumentUrl('http://captainpad.local/ui/touch_control.html', 'mount-1'))
      .toBe('http://captainpad.local/ui/touch_control.html?captainpad_document=mount-1');
    expect(nativePanelDocumentUrl(
      'http://captainpad.local/ui/touch_control.html?embed=1#spatial',
      'mount 2',
    )).toBe(
      'http://captainpad.local/ui/touch_control.html?embed=1&captainpad_document=mount%202#spatial',
    );
    expect(() => nativePanelDocumentUrl('', 'mount-1')).toThrow(/URL is missing/);
    expect(() => nativePanelDocumentUrl('http://captainpad.local', '')).toThrow(/token is missing/);
  });

  it('preserves the native endpoint contract while adding the document cache token', () => {
    const panelUrl = resolveLiveTouchPanelUrl(
      'http://show-host.local:6968',
      '/CaptainPad/live_touch/touch_control.html',
      '6969',
      null,
      LIVE_TOUCH_NATIVE_EMBED,
    );
    const documentUrl = nativePanelDocumentUrl(panelUrl, 'mount 7');
    expect(documentUrl).toBe(
      'http://show-host.local:6969/CaptainPad/live_touch/touch_control.html'
      + '?captainpad_embed=native'
      + '&captainpad_engine_origin=http%3A%2F%2Fshow-host.local%3A6968'
      + '&captainpad_live_touch_protocol=2'
      + '&captainpad_document=mount%207',
    );
    expect(validateLiveTouchPanelUrl(
      documentUrl,
      'http://show-host.local:6968',
    )).toBe(documentUrl);
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

    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-pixel-verifier-ready',
      version: 1,
      documentId: 'pixel-document-7',
      phase: 'wire-ready',
      staticVerified: true,
      engineVerified: false,
      readyStatus: 'fulfilled',
    })).toEqual({
      type: 'touch-control-pixel-verifier-ready',
      version: 1,
      documentId: 'pixel-document-7',
      phase: 'wire-ready',
      staticVerified: true,
      engineVerified: false,
      readyStatus: 'fulfilled',
    });

    expect(parseTouchControlBridgeMessage({
      type: 'touch-control-pixel-verification',
      version: 1,
      documentId: 'pixel-document-7',
      requestId: 'pixel-verify-9',
      status: 'failed',
      phase: 'engine-layout-fetch',
      staticVerified: true,
      engineVerified: false,
      readyStatus: 'fulfilled',
      error: 'engine topology request timed out',
    })).toEqual({
      type: 'touch-control-pixel-verification',
      version: 1,
      documentId: 'pixel-document-7',
      requestId: 'pixel-verify-9',
      status: 'failed',
      phase: 'engine-layout-fetch',
      staticVerified: true,
      engineVerified: false,
      readyStatus: 'fulfilled',
      error: 'engine topology request timed out',
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
      type: 'touch-control-pixel-verification',
      version: 1,
      documentId: 'pixel-document-7',
      requestId: 'pixel-verify-9',
      status: 'ready',
      phase: 'complete',
      staticVerified: 'yes',
      engineVerified: true,
      readyStatus: 'fulfilled',
      error: null,
    })).toThrow(/invalid gate state/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'touch-control-pixel-verifier-ready',
      version: 1,
      staticVerified: true,
      engineVerified: true,
      phase: 'wire-ready',
      readyStatus: 'fulfilled',
    })).toThrow(/missing documentId/);
    expect(() => parseTouchControlBridgeMessage({
      type: 'surprise',
      version: 1,
    })).toThrow(/unknown bridge message/);
  });
});
