(function () {
  'use strict';

  var BRIDGE_VERSION = 1;
  var PARENT_ORIGIN_PARAM = 'captainpad_origin';
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

  if (window.parent === window) {
    document.documentElement.classList.add('standalone-dark');
    return;
  }

  var parentOrigin;
  try {
    parentOrigin = declaredParentOrigin();
  } catch (error) {
    fail(error.message);
    return;
  }

  document.documentElement.classList.add('captainpad-embedded', 'theme-pending');
  installChromeStyles();
  var pendingTimer = window.setTimeout(function () {
    if (document.documentElement.classList.contains('theme-pending')) {
      fail('UNAVAILABLE - no valid theme arrived within one second');
    }
  }, 1000);

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    if (event.origin !== parentOrigin) {
      fail('rejected a message from unexpected origin ' + event.origin);
      return;
    }
    if (!isRecord(event.data) || event.data.version !== BRIDGE_VERSION) {
      fail('rejected a malformed or unsupported parent message');
      return;
    }

    if (event.data.type === 'captainpad-theme') {
      try {
        var theme = validateTheme(event.data);
        applyTheme(theme);
        window.clearTimeout(pendingTimer);
        window.parent.postMessage({
          type: 'touch-control-theme-applied',
          version: BRIDGE_VERSION,
          requestId: theme.requestId,
        }, parentOrigin);
      } catch (error) {
        fail(error.message);
      }
      return;
    }

    if (event.data.type === 'captainpad-surface-focus') {
      if (typeof event.data.requestId !== 'string' || !event.data.requestId) {
        fail('surface focus requires a requestId');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:surface-focus', {
        detail: { requestId: event.data.requestId },
      }));
      return;
    }

    if (event.data.type === 'captainpad-surface-blur') {
      if (typeof event.data.requestId !== 'string' || !event.data.requestId) {
        fail('surface blur requires a requestId');
        return;
      }
      if (event.data.target !== 'deck' && event.data.target !== 'mixer') {
        fail('surface blur requires a Deck or Mixer destination');
        return;
      }
      if (event.data.reason !== 'navigation' && event.data.reason !== 'background') {
        fail('surface blur requires a navigation or background reason');
        return;
      }
      document.dispatchEvent(new CustomEvent('captainpad:surface-blur', {
        detail: {
          requestId: event.data.requestId,
          target: event.data.target,
          reason: event.data.reason,
        },
      }));
      return;
    }

    fail('rejected unknown parent message ' + String(event.data.type));
  });

  window.parent.postMessage({
    type: 'touch-control-theme-ready',
    version: BRIDGE_VERSION,
  }, parentOrigin);
}());
