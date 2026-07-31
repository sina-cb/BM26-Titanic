/**
 * controllers_pane_toggle.test.js — the Controllers-section hide/show toggle
 * in the Controller Mapping pane (operator request: the controllers list buries
 * the unmapped tray + Save row while live-mapping).
 *
 *  G1 — the persisted-value parser: only the exact written marker reads as
 *       collapsed; absent / junk / legacy values read as EXPANDED (the state
 *       that shows the operator everything).
 *  G2 — the button's glyph/title follow the ▾/▸ chevron idiom the DMX/MarsinLED
 *       group heads already use, and the two states are distinguishable.
 *  G3 — the class the JS toggles is the class the stylesheet acts on, and that
 *       rule hides ONLY the controllers scroll region (.cm-main) — the tray,
 *       Save row and hint below it must stay visible, which is the whole point.
 *
 * controller_map_editor.js is a browser module (its siblings assign `window` at
 * load), so `window` is stubbed before the dynamic import — same recipe as
 * led_segments_persistence.test.js. `localStorage` is deliberately NOT stubbed:
 * the module reads the pref at import time and must survive its absence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};

const {
  parseControllersCollapsed,
  controllersToggleState,
  CONTROLLERS_COLLAPSED_CLASS,
} = await import('../src/gui/controller_map_editor.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, '..', 'style.css'), 'utf8');

// ── G1: persisted value ──────────────────────────────────────────────────

test('parseControllersCollapsed treats only the written marker as collapsed', () => {
  assert.equal(parseControllersCollapsed('1'), true);
  assert.equal(parseControllersCollapsed('0'), false);
});

test('parseControllersCollapsed reads absent/junk state as expanded', () => {
  assert.equal(parseControllersCollapsed(null), false);
  assert.equal(parseControllersCollapsed(undefined), false);
  assert.equal(parseControllersCollapsed(''), false);
  assert.equal(parseControllersCollapsed('true'), false);
  assert.equal(parseControllersCollapsed('{"collapsed":true}'), false);
});

// ── G2: button paint ─────────────────────────────────────────────────────

test('controllersToggleState uses the pane chevron idiom, one glyph per state', () => {
  assert.equal(controllersToggleState(false).glyph, '▾');
  assert.equal(controllersToggleState(true).glyph, '▸');
});

test('controllersToggleState titles say which way the click goes', () => {
  const expanded = controllersToggleState(false);
  const collapsed = controllersToggleState(true);
  assert.match(expanded.title, /Hide the controllers list/);
  assert.match(collapsed.title, /Show the controllers list/);
  assert.notEqual(expanded.title, collapsed.title);
});

test('controllersToggleState promises the toggle is display-only', () => {
  // The operator hits this button mid-mapping with hardware attached: the
  // tooltip must never imply a patch changes hands.
  assert.match(controllersToggleState(false).title, /display only/i);
});

// ── G3: JS class ↔ stylesheet contract ───────────────────────────────────

test('the toggled class is the class style.css acts on', () => {
  assert.equal(CONTROLLERS_COLLAPSED_CLASS, 'cm-controllers-collapsed');
  assert.ok(
    CSS.includes(`.cm-body.${CONTROLLERS_COLLAPSED_CLASS} .cm-main`),
    'style.css must hide .cm-main under the collapsed body class',
  );
});

test('the collapsed rule hides the controllers region and nothing below it', () => {
  const rule = new RegExp(
    `\\.cm-body\\.${CONTROLLERS_COLLAPSED_CLASS} \\.cm-main \\{[^}]*display:\\s*none`,
  );
  assert.match(CSS, rule);
  // The tray / Save row / hint live BELOW .cm-main — hiding them would defeat
  // the feature, so no collapsed rule may set display:none on them.
  for (const below of ['cm-tray', 'vm-save', 'cm-hint']) {
    const bad = new RegExp(
      `\\.cm-body\\.${CONTROLLERS_COLLAPSED_CLASS} \\.${below}[^{]*\\{[^}]*display:\\s*none`,
    );
    assert.doesNotMatch(CSS, bad, `${below} must stay visible when collapsed`);
  }
});

test('the collapsed tray gets the freed space (no compact chip cap)', () => {
  assert.match(
    CSS,
    new RegExp(`\\.cm-body\\.${CONTROLLERS_COLLAPSED_CLASS} \\.cm-tray-chips \\{[^}]*max-height:\\s*none`),
  );
});

test('the section head is styled and lives outside the scroll region', () => {
  // .cm-section-head is appended to #cm-body, not .cm-main — if it were inside
  // the scroll region the collapse would hide its own way back.
  assert.ok(CSS.includes('.cm-section-head'), 'section head must be styled');
  const src = fs.readFileSync(
    path.join(HERE, '..', 'src', 'gui', 'controller_map_editor.js'), 'utf8');
  assert.match(src, /bodyEl\.appendChild\(renderControllersSectionHead\(/);
  assert.doesNotMatch(src, /main\.appendChild\(renderControllersSectionHead\(/);
});
