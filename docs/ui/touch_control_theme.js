(function () {
  'use strict';

  var BRIDGE_VERSION = 1;
  var PARENT_ORIGIN_PARAM = 'captainpad_origin';
  /* CaptainPad has THREE embed modes now (report _252, docs/60 §4.3):
       standalone — opened directly in a browser; no host, dark theme, no bridge.
       iframe     — the CaptainPad WEB build; host is `window.parent`, messages
                    are origin-checked in both directions.
       native     — the CaptainPad iPad build; host is a react-native-webview,
                    declared by this query param because `window.parent === window`
                    inside a WebView and iframe detection cannot see it.
     Everything downstream of the transport below is identical in the two
     embedded modes: the same versioned schema, the same validate/apply/ack
     pipeline, the same failure messages. */
  var EMBED_PARAM = 'captainpad_embed';
  var NATIVE_EMBED = 'native';
  var THEME_IDS = {
    light: true, dark: true, midnight: true, sunset: true,
    gruvbox: true, system: true,
  };
  var THEME_KEYS = [
    'text',
    'background',
    'tint',
    'icon',
    'surface',
    'surfaceContainerLow',
    'surfaceContainerLowest',
    'surfaceContainerHigh',
    'primary',
    'onPrimary',
    'secondary',
    'tertiary',
    'error',
    'ghostBorder',
    'ambientShadow',
  ];
  var CSS_TOKEN_MAP = {
    background: '--bg',
    surfaceContainerLowest: '--bg-elevated',
    surfaceContainerHigh: '--panel',
    surfaceContainerLow: '--panel-2',
    ghostBorder: '--border',
    text: '--text',
    secondary: '--text-soft',
  };

  function fail(message) {
    var fullMessage = 'CAPTAINPAD THEME LINK: ' + message;
    // Release the first-paint gate stamped in the document head. A failed theme
    // handshake must surface as a visible error on a visible panel, never as a
    // blank rectangle. The palette is NOT substituted — the panel simply shows
    // itself unthemed alongside the error.
    document.documentElement.classList.remove('theme-pending');
    console.error('[touch-control-theme]', fullMessage);
    document.dispatchEvent(new CustomEvent('panelerror', {
      detail: { message: fullMessage },
    }));
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function declaredParentOrigin() {
    var raw = new URL(window.location.href).searchParams.get(PARENT_ORIGIN_PARAM);
    if (!raw) throw new Error('embedded panel URL is missing ' + PARENT_ORIGIN_PARAM);
    var parsed = new URL(raw);
    if (parsed.origin !== raw) throw new Error('declared parent origin must not include a path');
    return parsed.origin;
  }

  /** Which host is on the other end of this page. Throws (→ `fail`) on a param
   *  value nobody ships, rather than quietly deciding it is standalone. */
  function embedMode() {
    var raw = new URL(window.location.href).searchParams.get(EMBED_PARAM);
    if (raw === NATIVE_EMBED) return 'native';
    if (raw) throw new Error('unknown ' + EMBED_PARAM + ' value ' + raw);
    return window.parent !== window ? 'iframe' : 'standalone';
  }

  /**
   * Build the one object every page→host message goes through.
   *
   * iframe mode is the ORIGINAL code path, moved verbatim: same
   * `window.parent.postMessage(message, parentOrigin)` with the same declared
   * origin, so nothing about the web embed changes by construction.
   *
   * native mode hands the JSON to `window.ReactNativeWebView.postMessage`. That
   * channel is host-authenticated by construction — only the app can inject JS
   * into this WebView, and only this page's own JS can post out of it — so
   * there is no origin to check and, deliberately, NO `window` 'message'
   * listener is installed in native mode. One fewer listening surface.
   */
  function buildTransport(mode) {
    if (mode === 'native') {
      var rn = window.ReactNativeWebView;
      if (!rn || typeof rn.postMessage !== 'function') {
        /* The URL says native but nothing native is here: the panel was opened
           in Safari with the param, or the WebView bridge is broken. Loud, and
           never a silent slide back to standalone. */
        throw new Error(
          'UNAVAILABLE - ' + EMBED_PARAM + '=' + NATIVE_EMBED + ' but this page is not '
          + 'inside a CaptainPad WebView'
        );
      }
      return {
        mode: 'native',
        embedded: true,
        parentOrigin: null,
        post: function (message) { rn.postMessage(JSON.stringify(message)); },
      };
    }

    var origin = declaredParentOrigin();
    return {
      mode: 'iframe',
      embedded: true,
      parentOrigin: origin,
      post: function (message) { window.parent.postMessage(message, origin); },
    };
  }

  function supportsColor(value) {
    return typeof value === 'string' && value.length > 0 && CSS.supports('color', value);
  }

  function validateTheme(message) {
    if (!isRecord(message)) throw new Error('theme payload is not an object');
    if (message.type !== 'captainpad-theme') throw new Error('unexpected message type');
    if (message.version !== BRIDGE_VERSION) throw new Error('unsupported bridge version');
    if (typeof message.requestId !== 'string' || !message.requestId) {
      throw new Error('theme payload is missing requestId');
    }
    if (message.scheme !== 'light' && message.scheme !== 'dark') {
      throw new Error('theme payload has an invalid scheme');
    }
    if (!THEME_IDS[message.themeId]) throw new Error('theme payload has an invalid themeId');
    if (!THEME_IDS[message.resolvedThemeId] || message.resolvedThemeId === 'system') {
      throw new Error('theme payload has an invalid resolvedThemeId');
    }
    if (!isRecord(message.palette)) throw new Error('theme payload is missing palette');

    var palette = {};
    THEME_KEYS.forEach(function (key) {
      var value = message.palette[key];
      if (!supportsColor(value)) throw new Error('theme token ' + key + ' is not a CSS color');
      palette[key] = value;
    });
    if (Object.keys(message.palette).length !== THEME_KEYS.length) {
      throw new Error('theme palette contains an unknown or duplicate token');
    }

    return {
      requestId: message.requestId,
      scheme: message.scheme,
      palette: palette,
    };
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    var palette = theme.palette;

    Object.keys(CSS_TOKEN_MAP).forEach(function (key) {
      root.style.setProperty(CSS_TOKEN_MAP[key], palette[key]);
    });
    root.style.setProperty('--border-strong', palette.ghostBorder);
    root.style.setProperty('--text-dim', palette.secondary);
    root.style.setProperty('--captainpad-primary', palette.primary);
    root.style.setProperty('--captainpad-on-primary', palette.onPrimary);
    root.style.setProperty('--captainpad-tertiary', palette.tertiary);
    root.style.setProperty('--captainpad-error', palette.error);
    root.style.setProperty('--captainpad-icon', palette.icon);
    root.style.setProperty('--captainpad-surface', palette.surface);
    root.style.setProperty('--captainpad-shadow', palette.ambientShadow);
    root.style.colorScheme = theme.scheme;
    root.classList.remove('theme-pending');
    root.classList.add('theme-applied');
  }

  function installChromeStyles() {
    var style = document.createElement('style');
    style.id = 'captainpad-theme-chrome';
    style.textContent = [
      'html, body { background: var(--bg); }',
      '.topbar { background: var(--panel-2); box-shadow: 0 10px 30px var(--captainpad-shadow); }',
      '.panel { background: var(--panel); box-shadow: 0 6px 16px var(--captainpad-shadow); }',
      '.rail-tab, .preset-cell, .lock-btn, .stepper button, .select,',
      '.fx-cell, .fx-pick, .aud-mode, .footer-note {',
      '  background-color: var(--bg-elevated); color: var(--text-soft);',
      '}',
      'select option, select optgroup { background-color: var(--bg-elevated); color: var(--text); }',
      'select option:checked { background-color: var(--panel); color: var(--text); }',
      '.meter-bpm b, .meter-note b, .sig-val { color: var(--text); }',
      '.fader-strip.is-focused, .fader-strip.is-sel, .color-slot.is-selected, .is-selected {',
      '  border-color: var(--captainpad-primary);',
      '}',
      '.arm-control.is-armed {',
      '  border-color: var(--captainpad-tertiary);',
      '  box-shadow: 0 0 24px var(--captainpad-tertiary);',
      '}',
      '.arm-control.is-armed .state { color: var(--captainpad-tertiary); }',
      '.arm-control:not(.is-armed) { border-color: var(--captainpad-error); }',
      '.arm-control:not(.is-armed) .state { color: var(--captainpad-error); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  var mode;
  var transport;
  try {
    mode = embedMode();
  } catch (error) {
    fail(error.message);
    return;
  }

  if (mode === 'standalone') {
    document.documentElement.classList.add('standalone-dark');
    window.CaptainPadEmbed = {
      mode: 'standalone',
      embedded: false,
      parentOrigin: null,
      post: function () {
        throw new Error('Live Touch is standalone: there is no CaptainPad host to post to');
      },
    };
    return;
  }

  try {
    transport = buildTransport(mode);
  } catch (error) {
    fail(error.message);
    return;
  }

  /* Published for the other two page-side touchpoints — `touch_control_wire.js`
     (the surface-release ack) and the spatial fullscreen requester in
     `touch_control.html`. Every page→host message in this panel goes through
     this ONE object; a raw postMessage anywhere else would be a fourth embed
     mode nobody tests. */
  window.CaptainPadEmbed = transport;

  document.documentElement.classList.add('captainpad-embedded', 'theme-pending');
  installChromeStyles();
  var pendingTimer = window.setTimeout(function () {
    if (document.documentElement.classList.contains('theme-pending')) {
      fail('UNAVAILABLE - no valid theme arrived within one second');
    }
  }, 1000);

  /** The ONE host→page pipeline. The iframe listener and the native
   *  `__captainpadDeliver` hook both feed exactly this, so a message means the
   *  same thing on both platforms or it means nothing. */
  function deliver(data) {
    if (!isRecord(data) || data.version !== BRIDGE_VERSION) {
      fail('rejected a malformed or unsupported parent message');
      return;
    }

    if (data.type === 'captainpad-theme') {
      try {
        var theme = validateTheme(data);
        applyTheme(theme);
        window.clearTimeout(pendingTimer);
        transport.post({
          type: 'touch-control-theme-applied',
          version: BRIDGE_VERSION,
          requestId: theme.requestId,
        });
      } catch (error) {
        fail(error.message);
      }
      return;
    }

    if (data.type === 'captainpad-surface-focus') {
      if (typeof data.requestId !== 'string' || !data.requestId) {
        fail('surface focus requires a requestId');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:surface-focus', {
        detail: { requestId: data.requestId },
      }));
      return;
    }

    if (data.type === 'captainpad-pixel-verification-start') {
      if (typeof data.documentId !== 'string' || !data.documentId) {
        fail('pixel verification start requires a documentId');
        return;
      }
      if (typeof data.requestId !== 'string' || !data.requestId) {
        fail('pixel verification start requires a requestId');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:pixel-verification-start', {
        detail: { documentId: data.documentId, requestId: data.requestId },
      }));
      return;
    }

    if (data.type === 'captainpad-surface-blur') {
      if (typeof data.requestId !== 'string' || !data.requestId) {
        fail('surface blur requires a requestId');
        return;
      }
      if (data.target !== 'deck' && data.target !== 'mixer') {
        fail('surface blur requires a Deck or Mixer destination');
        return;
      }
      if (data.reason !== 'navigation' && data.reason !== 'background') {
        fail('surface blur requires a navigation or background reason');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:surface-blur', {
        detail: {
          requestId: data.requestId,
          target: data.target,
          reason: data.reason,
        },
      }));
      return;
    }

    if (data.type === 'captainpad-spatial-fullscreen-applied') {
      if (typeof data.requestId !== 'string' || !data.requestId ||
          typeof data.active !== 'boolean') {
        fail('spatial fullscreen acknowledgement is malformed');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:spatial-fullscreen-applied', {
        detail: {
          requestId: data.requestId,
          active: data.active,
        },
      }));
      return;
    }

    fail('rejected unknown parent message ' + String(data.type));
  }

  if (mode === 'native') {
    /* Installed BEFORE `touch-control-theme-ready` is posted, and the native
       host only sends after receiving that event — so the host can never inject
       a call to a function that does not exist yet. An injected call is used
       rather than `webViewRef.postMessage`, whose delivery target ('message' on
       `window` vs on `document`) has differed across react-native-webview
       versions; this is deterministic. */
    window.__captainpadDeliver = function (message) { deliver(message); };
  } else {
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      if (event.origin !== transport.parentOrigin) {
        fail('rejected a message from unexpected origin ' + event.origin);
        return;
      }
      deliver(event.data);
    });
  }

  document.addEventListener('touchcontrol:spatial-fullscreen-request', function (event) {
    var detail = event.detail || {};
    if (typeof detail.requestId !== 'string' || !detail.requestId ||
        typeof detail.active !== 'boolean') {
      fail('spatial fullscreen request is malformed');
      return;
    }
    transport.post({
      type: 'touch-control-spatial-fullscreen',
      version: BRIDGE_VERSION,
      requestId: detail.requestId,
      active: detail.active,
    });
  });

  transport.post({
    type: 'touch-control-theme-ready',
    version: BRIDGE_VERSION,
  });
}());
