/**
 * The mouse wheel scrolls the sim GUI. It NEVER edits a value.
 *
 * Operator order 2026-07-29: "In the simulation GUI, disallow mouse scroll from
 * updating the parameters! I randomly accidentally set some values to 0 when I
 * scroll in the menu."
 *
 * Two halves, and killing either alone leaves the bug alive:
 *   1. our own wheel-to-value handlers in modern_gui/controllers.js (DELETED);
 *   2. Chrome's native stepping of a FOCUSED `<input type="number">`, which is
 *      a default action no `stopPropagation` can reach (disarmed by blurring).
 *
 * The guard's behaviour is unit-tested against a minimal DOM stub (no jsdom
 * dependency in this repo); the deletions in the GUI engine are pinned by
 * source contract, the same tool rename_hygiene_wiring.test.js uses for wiring
 * facts inside browser-only closures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  GUARDED_SELECTORS, NATIVE_STEPPING_SELECTORS, guardedControlFor, installWheelGuard,
} from '../src/gui/wheel_guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const CONTROLLERS = read('src', 'gui', 'modern_gui', 'controllers.js');
const MAIN = read('main.js');

// ── Minimal DOM stub ───────────────────────────────────────────────────────

function elem(tag, attrs = {}, className = '') {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    className,
    blurred: 0,
    matches(sel) {
      return sel.split(',').some((s) => {
        const t = s.trim();
        // Class selector (`.slider`).
        if (t.startsWith('.')) return this.className.split(/\s+/).includes(t.slice(1));
        // Tag selector, optionally with an attribute filter (`input[type=number]`).
        const m = t.match(/^(\w+)(?:\[type=(\w+)\])?$/);
        if (!m) return false;
        if (m[1].toUpperCase() !== this.tagName) return false;
        return m[2] === undefined || this.attrs.type === m[2];
      });
    },
    blur() { this.blurred += 1; if (node.ownerDocument) node.ownerDocument.activeElement = null; },
    ownerDocument: null,
  };
  return node;
}

function host() {
  const listeners = [];
  return {
    activeElement: null,
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    listeners,
    fire(type, event) {
      listeners.filter((l) => l.type === type).forEach((l) => l.fn(event));
      return event;
    },
  };
}

function wheelEvent(pathNodes) {
  const ev = {
    type: 'wheel',
    target: pathNodes[0],
    stopped: 0,
    prevented: 0,
    composedPath: () => pathNodes,
    stopPropagation() { this.stopped += 1; },
    preventDefault() { this.prevented += 1; },
  };
  return ev;
}

function setup() {
  const doc = host();
  const guard = installWheelGuard(doc);
  const mk = (tag, attrs, cls) => { const n = elem(tag, attrs, cls); n.ownerDocument = doc; return n; };
  return { doc, guard, mk };
}

// ── What counts as a value control ─────────────────────────────────────────

test('the browser-stepped controls are number, range and select', () => {
  assert.deepEqual(NATIVE_STEPPING_SELECTORS,
    ['input[type=number]', 'input[type=range]', 'select']);
});

test('the guard also covers the FADER, which is a div, not a native input', () => {
  // MarsinGui builds its fader as `div.slider` (modern_gui/controllers.js
  // `_initSlider`). Handler-deletion alone protects it only while nobody
  // re-adds a wheel listener; being in GUARDED_SELECTORS makes it structural.
  assert.deepEqual(GUARDED_SELECTORS,
    ['input[type=number]', 'input[type=range]', 'select', '.slider']);
  assert.match(CONTROLLERS, /classList\.add\('slider'\)/,
    'the guard selector must match the class the GUI engine actually assigns');
});

test('a wheel over the fader is stopped but NOT blurred', () => {
  const { doc, guard, mk } = setup();
  const slider = mk('div', {}, 'slider');
  doc.activeElement = slider;   // the fader carries tabindex=0
  const ev = doc.fire('wheel', wheelEvent([mk('div', {}, 'fill'), slider, mk('div')]));
  assert.equal(ev.stopped, 1, 'no re-added wheel handler may turn the tick into an edit');
  assert.equal(ev.prevented, 0, 'the panel must still scroll over a fader');
  assert.equal(slider.blurred, 0,
    'nothing in the browser steps a div — blurring it would break keyboard editing');
  assert.equal(guard.swallowed, 1);
});

test('guardedControlFor finds the control anywhere in the event path', () => {
  const input = elem('input', { type: 'number' });
  const widget = elem('div');
  const panel = elem('div');
  assert.equal(guardedControlFor(wheelEvent([input, widget, panel])), input);
});

test('guardedControlFor ignores a canvas, a text input and a button', () => {
  for (const node of [
    elem('canvas'), elem('input', { type: 'text' }), elem('button'), elem('div'),
  ]) {
    assert.equal(guardedControlFor(wheelEvent([node, elem('div')])), null,
      `${node.tagName} must not be guarded`);
  }
});

test('guardedControlFor tolerates a missing or malformed event', () => {
  assert.equal(guardedControlFor(null), null);
  assert.equal(guardedControlFor({}), null);
});

// ── Requirement 2: no value change from wheel, ever ────────────────────────

test('a wheel over a number input stops propagation to controller handlers', () => {
  const { doc, guard, mk } = setup();
  const input = mk('input', { type: 'number' });
  const ev = doc.fire('wheel', wheelEvent([input, mk('div')]));
  assert.equal(ev.stopped, 1, 'no descendant handler may turn the tick into an edit');
  assert.equal(guard.swallowed, 1);
});

test('a FOCUSED number input is blurred so the browser cannot step it', () => {
  const { doc, mk } = setup();
  const input = mk('input', { type: 'number' });
  doc.activeElement = input;
  doc.fire('wheel', wheelEvent([input]));
  assert.equal(input.blurred, 1,
    "Chrome steps a focused number input as a DEFAULT ACTION — stopPropagation cannot reach it");
  assert.equal(doc.activeElement, null);
});

test('an UNfocused control is not blurred (nothing to disarm)', () => {
  const { doc, mk } = setup();
  const input = mk('input', { type: 'number' });
  doc.activeElement = mk('input', { type: 'text' });
  doc.fire('wheel', wheelEvent([input]));
  assert.equal(input.blurred, 0);
});

test('select and range are guarded the same way', () => {
  for (const [tag, attrs] of [['select', {}], ['input', { type: 'range' }]]) {
    const { doc, guard, mk } = setup();
    const node = mk(tag, attrs);
    doc.activeElement = node;
    const ev = doc.fire('wheel', wheelEvent([node]));
    assert.equal(ev.stopped, 1, `${tag} must stop propagation`);
    assert.equal(node.blurred, 1, `${tag} must be blurred`);
    assert.equal(guard.swallowed, 1);
  }
});

// ── Requirement 1: the panel must still scroll ─────────────────────────────

test('the guard NEVER calls preventDefault — preventing the wheel kills the scroll', () => {
  const { doc, mk } = setup();
  const input = mk('input', { type: 'number' });
  doc.activeElement = input;
  const ev = doc.fire('wheel', wheelEvent([input, mk('div')]));
  assert.equal(ev.prevented, 0,
    'scrolling must keep working even with the cursor over a slider');
});

test('the listener is registered passive, which forbids preventDefault outright', () => {
  const { doc } = setup();
  const l = doc.listeners.find((x) => x.type === 'wheel');
  assert.equal(l.opts.capture, true, 'capture — it must run before any controller handler');
  assert.equal(l.opts.passive, true, 'passive — the scroll can never be blocked, by construction');
});

test('a wheel over a canvas is untouched — 3D orbit + pixel-map zoom still work', () => {
  const { doc, guard, mk } = setup();
  const canvas = mk('canvas');
  const ev = doc.fire('wheel', wheelEvent([canvas, mk('div')]));
  assert.equal(ev.stopped, 0);
  assert.equal(ev.prevented, 0);
  assert.equal(guard.swallowed, 0, 'a canvas gesture is not a swallowed edit');
});

test('a wheel over plain panel chrome scrolls untouched', () => {
  const { doc, guard, mk } = setup();
  const ev = doc.fire('wheel', wheelEvent([mk('div'), mk('div')]));
  assert.equal(ev.stopped, 0);
  assert.equal(guard.swallowed, 0);
});

// ── Installer hygiene ──────────────────────────────────────────────────────

test('installing twice does not stack listeners', () => {
  const { doc, guard } = setup();
  const again = installWheelGuard(doc);
  assert.equal(again, guard, 'the same state object comes back');
  assert.equal(doc.listeners.filter((l) => l.type === 'wheel').length, 1);
});

test('uninstall removes the listener and allows a clean re-install', () => {
  const { doc, guard } = setup();
  guard.uninstall();
  assert.equal(doc.listeners.filter((l) => l.type === 'wheel').length, 0);
  installWheelGuard(doc);
  assert.equal(doc.listeners.filter((l) => l.type === 'wheel').length, 1);
});

test('the swallowed counter is the evidence trail', () => {
  const { doc, guard, mk } = setup();
  const input = mk('input', { type: 'number' });
  for (let i = 0; i < 5; i++) doc.fire('wheel', wheelEvent([input]));
  doc.fire('wheel', wheelEvent([mk('canvas')]));
  assert.equal(guard.swallowed, 5, 'counts denied edits only, not every wheel tick');
});

// ── Source contract: the engine's own handlers are GONE ────────────────────

test('modern_gui NumberController has NO wheel listener at all', () => {
  assert.doesNotMatch(CONTROLLERS, /addEventListener\('wheel'/,
    'a wheel-to-value handler in the GUI engine is the bug the operator reported');
});

test('the dead wheel math went with the handlers', () => {
  // Leaving `_normalizeMouseWheel` behind is an invitation to re-wire it.
  assert.doesNotMatch(CONTROLLERS, /_normalizeMouseWheel\s*\(e\)\s*\{/);
  assert.doesNotMatch(CONTROLLERS, /get _hasScrollBar\(\)/,
    'the scrollbar-dependent guard was the reason the bug was intermittent');
});

test('deliberate editing paths are still wired', () => {
  // The wheel is gone; drag, keyboard and typing must NOT be.
  assert.match(CONTROLLERS, /addEventListener\('pointerdown'/);
  assert.match(CONTROLLERS, /addEventListener\('keydown'/);
  assert.match(CONTROLLERS, /addEventListener\('input'/);
  assert.match(CONTROLLERS, /_arrowKeyMultiplier/);
});

test('main.js installs the guard once, at document level', () => {
  assert.match(MAIN, /import \{ installWheelGuard \} from "\.\/src\/gui\/wheel_guard\.js"/);
  assert.match(MAIN, /installWheelGuard\(document\)/);
  assert.equal((MAIN.match(/installWheelGuard\(document\)/g) || []).length, 1,
    'exactly ONE install site — a second would stack listeners on a GUI rebuild');
});
