/**
 * unpatched_red_two_views.test.js — "Show Unpatched (Red)" appears in TWO
 * places and can never disagree with itself.
 *
 * Operator, 2026-07-30: *"move that to the options as it affects the LEDs
 * too"*, then: *"actually don't move — clone it in the options too, but sync
 * them to 1 value please, both places would be nice."*
 *
 * So the switch is built in Lighting Control → ⚙️ Options AND at the top of the
 * fixtures panel. The thing that must be true is not "two checkboxes exist" but
 * that there is only ever ONE value behind them: one param, one persistence
 * key, no mirror state that could drift.
 *
 * The controls are built inside setupGUI's browser-only closure, so the wiring
 * is pinned by SOURCE CONTRACT — the same tool wheel_guard.test.js and
 * rename_hygiene_wiring.test.js use for facts that live inside a closure no
 * headless test can call. Behaviour under a live GUI was verified separately in
 * the operator's own running sim (report 20260725_82).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const GUI_BUILDER = read('src', 'gui', 'gui_builder.js');
const CONTROLLERS = read('src', 'gui', 'modern_gui', 'controllers.js');

function allSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allSourceFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

test('ONE builder defines the control, and it is used in exactly TWO places', () => {
  assert.equal(count(GUI_BUILDER, 'function addUnpatchedRedControl('), 1,
    'exactly one definition — name, tooltip and onChange live in one place so the ' +
    'two views cannot drift in behaviour');
  assert.equal(count(GUI_BUILDER, 'addUnpatchedRedControl(optionsFolder)'), 1,
    'view 1: Lighting Control → ⚙️ Options (it affects the LED bus too)');
  assert.equal(count(GUI_BUILDER, 'addUnpatchedRedControl(parFolder)'), 1,
    'view 2: the top of the fixtures panel, where it has always been');
});

test('ONE value: the param is bound in exactly one place in the whole source tree', () => {
  // Two views are fine. Two BINDINGS in two different builders would be two
  // chances to bind different objects/keys — and a second persistence key is
  // exactly the divergence the operator asked to be impossible.
  const bindings = allSourceFiles(SRC)
    .map((f) => [f, readFileSync(f, 'utf8')])
    .filter(([, src]) => /\.add\(\s*params\s*,\s*["']showUnpatchedRed["']/.test(src));
  assert.equal(bindings.length, 1,
    `showUnpatchedRed must be bound to a GUI control in exactly one source file, found: ` +
    bindings.map(([f]) => path.basename(f)).join(', '));
  assert.equal(path.basename(bindings[0][0]), 'gui_builder.js');
  assert.equal(count(bindings[0][1], '.add(params, "showUnpatchedRed")'), 1,
    'and exactly once inside it — the shared builder');
});

test('both views listen, so whichever one is flipped the other redraws itself', () => {
  const builder = GUI_BUILDER.slice(
    GUI_BUILDER.indexOf('function addUnpatchedRedControl('),
    GUI_BUILDER.indexOf('function buildOptionsSection('));
  assert.ok(/\.add\(params, "showUnpatchedRed"\)[\s\S]*?\.listen\(\)/.test(builder),
    'the shared builder must call .listen() — that is the sync mechanism');
  assert.ok(/refreshControllerMapPanel/.test(builder),
    'and it must refresh the Controller Mapping panel, the third view of the same flag');
});

test('the sync mechanism itself: listen() redraws on any external change', () => {
  // What .listen() buys, straight from the controller source: a per-frame poll
  // that calls updateDisplay() whenever the underlying value changed — no
  // matter who changed it. This is what makes two controllers bound to one
  // param agree without either knowing the other exists.
  const cb = CONTROLLERS.slice(CONTROLLERS.indexOf('_listenCallback() {'));
  assert.ok(/requestAnimationFrame\(this\._listenCallback\)/.test(cb),
    'the poll must re-arm every frame');
  assert.ok(/if \(value !== this\._listenPrevValue\) this\.updateDisplay\(\);/.test(cb),
    'and redraw exactly when the value changed under it');
});

test('no mirror state: nothing copies the flag into a second variable', () => {
  // A cached copy is the only way two views could disagree. Readers may READ
  // the param (animate.js, sacn_mapper's caller, the 2D map, the map panel) —
  // none may keep their own persisted copy of it.
  const offenders = allSourceFiles(SRC)
    .map((f) => [path.basename(f), readFileSync(f, 'utf8')])
    .filter(([, src]) => /(let|var|const)\s+\w*[Ss]howUnpatchedRed\w*\s*=\s*(?!.*params\.showUnpatchedRed)/.test(src));
  assert.deepEqual(offenders.map(([f]) => f), [],
    'no module may hold its own mutable copy of showUnpatchedRed');
});
