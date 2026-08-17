/* Live Touch embed transport — standalone / iframe / native.
 *
 * The panel is one page with THREE hosts now (report _252, docs/60 §4.3):
 * opened directly in a browser, embedded in CaptainPad's web build as an
 * iframe, or embedded in CaptainPad's iPad build as a react-native-webview.
 * The whole point of routing every page→host message through ONE transport
 * object is that the two embedded modes cannot drift; this suite is what pins
 * that, and — just as importantly — pins that the IFRAME mode still does
 * exactly what it did before native existed.
 *
 * No jsdom in this repo (offline readiness: nothing new is vendored for a
 * test). The stub below implements exactly the surface the theme module
 * touches, which also documents that surface.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const THEME_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control_theme.js');
const WIRE_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control_wire.js');
const PANEL_PATH = path.join(REPO_ROOT, 'docs/ui/touch_control.html');

const themeSource = fs.readFileSync(THEME_PATH, 'utf8');
const wireSource = fs.readFileSync(WIRE_PATH, 'utf8');
const panelSource = fs.readFileSync(PANEL_PATH, 'utf8');

const PANEL_URL = 'http://192.168.1.20:6969/docs/ui/touch_control.html';
const PARENT_ORIGIN = 'http://192.168.1.20:6967';

const THEME_KEYS = [
  'text', 'background', 'tint', 'icon', 'surface', 'surfaceContainerLow',
  'surfaceContainerLowest', 'surfaceContainerHigh', 'primary', 'onPrimary',
  'secondary', 'tertiary', 'error', 'ghostBorder', 'ambientShadow',
];

/** Objects built inside the vm realm have a foreign prototype, which
 *  `deepStrictEqual` counts as a difference. Compare their VALUES. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function themeMessage(requestId = 'theme-1') {
  const palette = {};
  THEME_KEYS.forEach((key) => { palette[key] = '#123456'; });
  return {
    type: 'captainpad-theme',
    version: 1,
    requestId,
    themeId: 'midnight',
    resolvedThemeId: 'midnight',
    scheme: 'dark',
    palette,
  };
}

// ── The smallest DOM the theme module can run in ───────────────────────────

function bootTheme({ url = PANEL_URL, iframe = false, reactNative = false } = {}) {
  const classes = new Set();
  /** Everything the page sent OUT, in order, each stamped with whether the
   *  native inbound hook already existed — the deliver-before-ready ordering
   *  guarantee is only checkable at post time. */
  const sent = [];
  const dispatched = [];
  const consoleErrors = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const timers = [];

  const style = {
    colorScheme: '',
    properties: {},
    setProperty(name, value) { this.properties[name] = value; },
  };

  const documentElement = {
    style,
    classList: {
      add(...names) { names.forEach((n) => classes.add(n)); },
      remove(...names) { names.forEach((n) => classes.delete(n)); },
      contains(name) { return classes.has(name); },
    },
  };

  const context = {
    console: { error: (...args) => consoleErrors.push(args.join(' ')) },
    URL,
    CSS: { supports: (_prop, value) => typeof value === 'string' && value.length > 0 },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
  };

  context.document = {
    documentElement,
    head: { appendChild() {} },
    createElement: () => ({ id: '', textContent: '' }),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    dispatchEvent(event) { dispatched.push(event); return true; },
  };

  const stamp = (payload, via) => {
    sent.push({
      via,
      payload,
      deliverInstalled: typeof context.window.__captainpadDeliver === 'function',
    });
  };

  context.window = {
    location: { href: url },
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
  };
  context.window.parent = iframe
    ? { postMessage: (message, origin) => stamp({ message, origin }, 'parent') }
    : context.window;
  if (reactNative) {
    context.window.ReactNativeWebView = {
      postMessage: (json) => stamp(json, 'native'),
    };
  }

  vm.createContext(context);
  vm.runInContext(themeSource, context, { filename: 'touch_control_theme.js' });

  return {
    context,
    classes,
    sent,
    dispatched,
    consoleErrors,
    timers,
    embed: () => context.window.CaptainPadEmbed,
    fireWindow(type, event) {
      (windowListeners.get(type) || []).forEach((handler) => handler(event));
    },
    fireDocument(type, event) {
      (documentListeners.get(type) || []).forEach((handler) => handler(event));
    },
    windowListenerTypes: () => [...windowListeners.keys()],
    errors: () => dispatched.filter((e) => e.type === 'panelerror').map((e) => e.detail.message),
  };
}

// ── standalone ─────────────────────────────────────────────────────────────

test('standalone: no host, dark theme, and nothing is ever posted', () => {
  const panel = bootTheme();
  assert.equal(panel.classes.has('standalone-dark'), true);
  assert.equal(panel.classes.has('theme-pending'), false);
  assert.equal(panel.classes.has('captainpad-embedded'), false);
  assert.deepEqual(panel.sent, []);
  assert.equal(panel.embed().embedded, false);
  assert.equal(panel.embed().mode, 'standalone');
  assert.throws(() => panel.embed().post({}), /no CaptainPad host/);
});

// ── iframe (the CaptainPad web build) — must be UNCHANGED ──────────────────

test('iframe: announces ready to the declared parent origin, exactly as before', () => {
  const panel = bootTheme({
    url: `${PANEL_URL}?captainpad_origin=${encodeURIComponent(PARENT_ORIGIN)}`,
    iframe: true,
  });
  assert.equal(panel.embed().mode, 'iframe');
  assert.equal(panel.embed().parentOrigin, PARENT_ORIGIN);
  assert.equal(panel.classes.has('captainpad-embedded'), true);
  assert.equal(panel.classes.has('theme-pending'), true);
  assert.deepEqual(panel.sent.map((s) => s.via), ['parent']);
  assert.deepEqual(plain(panel.sent[0].payload), {
    message: { type: 'touch-control-theme-ready', version: 1 },
    origin: PARENT_ORIGIN,
  });
  // The web listening surface is unchanged, and no native hook exists.
  assert.deepEqual(panel.windowListenerTypes(), ['message']);
  assert.equal(panel.context.window.__captainpadDeliver, undefined);
});

test('iframe: applies a theme from the parent and acks it to the same origin', () => {
  const panel = bootTheme({
    url: `${PANEL_URL}?captainpad_origin=${encodeURIComponent(PARENT_ORIGIN)}`,
    iframe: true,
  });
  panel.fireWindow('message', {
    source: panel.context.window.parent,
    origin: PARENT_ORIGIN,
    data: themeMessage('theme-42'),
  });
  assert.equal(panel.classes.has('theme-applied'), true);
  assert.equal(panel.classes.has('theme-pending'), false);
  assert.deepEqual(plain(panel.sent[1].payload), {
    message: { type: 'touch-control-theme-applied', version: 1, requestId: 'theme-42' },
    origin: PARENT_ORIGIN,
  });
  assert.deepEqual(panel.errors(), []);
});

test('iframe: still rejects a message from an unexpected origin', () => {
  const panel = bootTheme({
    url: `${PANEL_URL}?captainpad_origin=${encodeURIComponent(PARENT_ORIGIN)}`,
    iframe: true,
  });
  panel.fireWindow('message', {
    source: panel.context.window.parent,
    origin: 'http://evil.example',
    data: themeMessage(),
  });
  assert.match(panel.errors()[0], /unexpected origin http:\/\/evil\.example/);
});

test('iframe: still refuses to embed without a declared parent origin', () => {
  const panel = bootTheme({ iframe: true });
  assert.match(panel.errors()[0], /missing captainpad_origin/);
  assert.deepEqual(panel.sent, []);
});

// ── native (the CaptainPad iPad build) ─────────────────────────────────────

function bootNative(extra = '') {
  return bootTheme({
    url: `${PANEL_URL}?captainpad_embed=native${extra}`,
    iframe: false,
    reactNative: true,
  });
}

test('native: the WebView is the host even though this page is the top frame', () => {
  const panel = bootNative();
  assert.equal(panel.embed().mode, 'native');
  assert.equal(panel.embed().embedded, true);
  assert.equal(panel.embed().parentOrigin, null);
  assert.equal(panel.classes.has('captainpad-embedded'), true);
  assert.equal(panel.classes.has('theme-pending'), true);
  assert.equal(panel.classes.has('standalone-dark'), false);
});

test('native: posts JSON out through ReactNativeWebView, never to window.parent', () => {
  const panel = bootNative();
  assert.deepEqual(panel.sent.map((s) => s.via), ['native']);
  assert.deepEqual(JSON.parse(panel.sent[0].payload), {
    type: 'touch-control-theme-ready',
    version: 1,
  });
});

test('native: __captainpadDeliver exists BEFORE theme-ready goes out', () => {
  // The host only sends after theme-ready, so this ordering is what makes the
  // injection race impossible rather than merely unlikely.
  const panel = bootNative();
  assert.equal(panel.sent[0].deliverInstalled, true);
  assert.equal(typeof panel.context.window.__captainpadDeliver, 'function');
});

test('native: installs NO window message listener — one fewer listening surface', () => {
  const panel = bootNative();
  assert.deepEqual(panel.windowListenerTypes(), []);
});

test('native: an injected theme applies and acks through the same pipeline', () => {
  const panel = bootNative();
  panel.context.window.__captainpadDeliver(themeMessage('theme-native-7'));
  assert.equal(panel.classes.has('theme-applied'), true);
  assert.equal(panel.classes.has('theme-pending'), false);
  assert.deepEqual(JSON.parse(panel.sent[1].payload), {
    type: 'touch-control-theme-applied',
    version: 1,
    requestId: 'theme-native-7',
  });
  assert.deepEqual(panel.errors(), []);
});

test('native: surface focus and blur reach the page as the same DOM events', () => {
  const panel = bootNative();
  panel.context.window.__captainpadDeliver({
    type: 'captainpad-surface-focus', version: 1, requestId: 'focus-1',
  });
  panel.context.window.__captainpadDeliver({
    type: 'captainpad-surface-blur', version: 1, requestId: 'blur-1',
    target: 'deck', reason: 'background',
  });
  const types = panel.dispatched.map((e) => e.type);
  assert.deepEqual(types, ['captainpad:surface-focus', 'captainpad:surface-blur']);
  assert.deepEqual(plain(panel.dispatched[1].detail), {
    requestId: 'blur-1', target: 'deck', reason: 'background',
  });
});

test('native: a malformed injected message fails LOUDLY and reveals the panel', () => {
  const panel = bootNative();
  panel.context.window.__captainpadDeliver({ type: 'captainpad-theme', version: 99 });
  assert.match(panel.errors()[0], /malformed or unsupported parent message/);
  assert.equal(panel.classes.has('theme-pending'), false);
  assert.equal(panel.consoleErrors.length, 1);
});

test('native: the spatial fullscreen request rides the same transport', () => {
  const panel = bootNative();
  panel.fireDocument('touchcontrol:spatial-fullscreen-request', {
    detail: { requestId: 'spatial-1', active: true },
  });
  assert.deepEqual(JSON.parse(panel.sent[1].payload), {
    type: 'touch-control-spatial-fullscreen',
    version: 1,
    requestId: 'spatial-1',
    active: true,
  });
});

test('native: NO ReactNativeWebView bridge is a loud failure, never a fallback', () => {
  // The panel opened in Safari with the param, or a broken WebView.
  const panel = bootTheme({ url: `${PANEL_URL}?captainpad_embed=native` });
  assert.match(panel.errors()[0], /not inside a CaptainPad WebView/);
  assert.equal(panel.classes.has('standalone-dark'), false);
  assert.equal(panel.classes.has('theme-pending'), false);
  assert.deepEqual(panel.sent, []);
});

test('an unknown captainpad_embed value is refused by name', () => {
  const panel = bootTheme({ url: `${PANEL_URL}?captainpad_embed=carrier-pigeon` });
  assert.match(panel.errors()[0], /unknown captainpad_embed value carrier-pigeon/);
  assert.deepEqual(panel.sent, []);
});

// ── the other three page-side touchpoints ──────────────────────────────────

test('the first-paint gate stamps theme-pending for BOTH embed modes', () => {
  const gate = /if \(window\.parent !== window \|\|\s*\n\s*new URL\(window\.location\.href\)\.searchParams\.get\('captainpad_embed'\) === 'native'\) \{/;
  assert.match(panelSource, gate);
});

test('the spatial requester asks the transport, not the frame tree', () => {
  assert.match(
    panelSource,
    /function requestHostFullscreen\(active\) \{[\s\S]*?var embed = window\.CaptainPadEmbed;\s*\n\s*if \(!embed \|\| !embed\.embedded\) return;/,
  );
});

test('the wire acknowledges a surface release through the transport', () => {
  assert.match(
    wireSource,
    /function acknowledgeSurfaceRelease\(requestId, target\) \{[\s\S]*?embed\.post\(\{\s*\n\s*type: 'touch-control-surface-released',/,
  );
});

/** Coarse comment strip, so this file's own prose about `postMessage` does not
 *  count as a call site. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('no page-side file posts to window.parent by hand any more', () => {
  // Every page→host message must go through the transport, or a fourth embed
  // mode exists that nothing above tests.
  assert.equal(/window\.parent\.postMessage/.test(codeOnly(wireSource)), false);
  assert.equal(/window\.parent\.postMessage/.test(codeOnly(panelSource)), false);
  // The theme module owns the only one, inside the iframe transport itself.
  assert.equal(
    (codeOnly(themeSource).match(/window\.parent\.postMessage/g) || []).length,
    1,
  );
});
