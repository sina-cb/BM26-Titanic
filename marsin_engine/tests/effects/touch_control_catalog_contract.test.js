import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { describeLibrary } from '../../lib/global_effect_library.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control.html');
const PANEL_SOURCE = fs.readFileSync(PANEL_PATH, 'utf8');
const WIRE_PATH = path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js');
const WIRE_SOURCE = fs.readFileSync(WIRE_PATH, 'utf8');

function objectKeysAfter(marker) {
  const start = PANEL_SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `touch panel is missing ${marker}`);
  const bodyStart = PANEL_SOURCE.indexOf('{', start);
  const bodyEnd = PANEL_SOURCE.indexOf('\n  };', bodyStart);
  assert.notEqual(bodyEnd, -1, `touch panel has no closing object for ${marker}`);
  return new Set(
    [...PANEL_SOURCE.slice(bodyStart, bodyEnd).matchAll(/^\s*'([^']+)':/gm)]
      .map(match => match[1]),
  );
}

test('touch panel effect catalog has no built-in fallback list', () => {
  assert.match(PANEL_SOURCE, /var FX_OPTS = \[\];\s*\/\* populated only from GET \/global-effect-library \*\//);
});

test('every engine effect preset has an explicit touch-panel face', () => {
  const faces = objectKeysAfter('var FX_SHORT = {');
  const expected = [];
  for (const [effectId, effect] of Object.entries(describeLibrary())) {
    for (const presetId of Object.keys(effect.presets)) expected.push(`${effectId}|${presetId}`);
  }
  assert.deepEqual([...faces].sort(), expected.sort());
});

test('every touch-panel default exists in the engine registry', () => {
  const defaultBlock = PANEL_SOURCE.match(/var FX_DEFAULT = \[([\s\S]*?)\n  \];/);
  assert.ok(defaultBlock, 'touch panel is missing FX_DEFAULT');
  const defaults = [...defaultBlock[1].matchAll(/'([^']+\|[^']+)'/g)].map(match => match[1]);
  assert.equal(defaults.length, 16, 'the 4x4 panel must declare exactly 16 defaults');

  const available = new Set();
  for (const [effectId, effect] of Object.entries(describeLibrary())) {
    for (const presetId of Object.keys(effect.presets)) available.add(`${effectId}|${presetId}`);
  }
  for (const key of defaults) assert.ok(available.has(key), `default ${key} is absent from the engine registry`);
});

/* `_302` W3. The reported "EFFECTS tiles do nothing, 0 active" was NOT a broken
   tile catalog: every rendered tile is bound to a real engine slot, and that
   binding is written ONLY by the ARM chain (`collectEffectSlotBuildOperations`
   -> `provisionCell` -> PATCH /global-effect-slots/:id). While ARM was aborting
   in `initialSpatialPrepareBody`, provisioning never ran, so the engine kept a
   PREVIOUS layout's slots and every visible tile was inert. These pins keep the
   tile -> slot -> engine chain closed, so a tile can never render as a silent
   no-op again. */

test('every rendered effect tile owns a distinct slot the panel is allowed to write', () => {
  const slotBlock = PANEL_SOURCE.match(/var FX_SLOTS = \[([^\]]*)\];/);
  assert.ok(slotBlock, 'touch panel is missing FX_SLOTS');
  const slots = slotBlock[1].split(',').map(entry => Number(entry.trim()));

  const defaultBlock = PANEL_SOURCE.match(/var FX_DEFAULT = \[([\s\S]*?)\n  \];/);
  assert.ok(defaultBlock, 'touch panel is missing FX_DEFAULT');
  const defaults = [...defaultBlock[1].matchAll(/'([^']+\|[^']+)'/g)].map(match => match[1]);

  assert.equal(slots.length, defaults.length,
    'every rendered tile must own exactly one slot — a tile without a slot cannot be provisioned');
  assert.equal(new Set(slots).size, slots.length,
    'two tiles sharing one slot would silently overwrite each other at ARM');

  /* 1-8 are the Deck's and the VSN1's; re-binding them would change the
     hardware panel under the operator. 32 is the engine slot manager's ceiling. */
  const oursFrom = Number(WIRE_SOURCE.match(/var OURS_FROM = (\d+);/)[1]);
  const maxSlots = Number(WIRE_SOURCE.match(/var MAX_SLOTS = (\d+);/)[1]);
  assert.equal(oursFrom, 9);
  assert.equal(maxSlots, 32);
  for (const slot of slots) {
    assert.ok(Number.isInteger(slot) && slot >= oursFrom && slot <= maxSlots,
      `tile slot ${slot} is outside the panel-owned range ${oursFrom}..${maxSlots}`);
  }
});

test('ARM provisions every rendered tile and proves the binding by readback', () => {
  /* Without this call in the ARM chain the tiles keep whatever the engine
     happened to hold — exactly the `_302` W3 symptom. */
  assert.match(
    WIRE_SOURCE,
    /function assertLiveSurfaceState\(\)[\s\S]*?\.then\(collectEffectSlotBuildOperations\)/,
    'ARM must provision the effect slots as part of staging the Live surface',
  );
  /* Provisioning walks the RENDERED cells, so a tile added to the grid is
     provisioned by construction rather than by a hand-maintained list. */
  assert.match(
    WIRE_SOURCE,
    /function collectEffectSlotBuildOperations\(\)[\s\S]*?fxGrid\.querySelectorAll\('\.fx-cell'\)[\s\S]*?provisionCell\(cell\)/,
    'slot provisioning must be driven by the rendered tiles',
  );
  /* Readback is what turns a failed PATCH into a loud ARM abort instead of a
     grid of dead buttons. */
  assert.match(
    WIRE_SOURCE,
    /function verifyPreparedSlots\(\)[\s\S]*?slotBinding\[slotId\] !== expected[\s\S]*?throw new Error\(/,
    'ARM must refuse loudly when a tile did not land on its slot',
  );
  assert.match(
    WIRE_SOURCE,
    /verifyPreparedSlots\(\),/,
    'the atomic prepare acknowledgement must be followed by the slot readback',
  );
});

test('a tile with no authoritative behavior is refused instead of guessed', () => {
  assert.match(
    WIRE_SOURCE,
    /function provisionCell\(cell\)[\s\S]*?if \(behavior !== 'toggle' && behavior !== 'trigger' && behavior !== 'hold'\)[\s\S]*?reject\(new Error\('effect button has no authoritative behavior'\)\)/,
    'provisioning must never default a missing behavior',
  );
  /* An unprovisioned tile is marked, so an inert button is visible as inert
     rather than reading as a working control that does nothing. */
  assert.match(
    WIRE_SOURCE,
    /function markCells\(\)[\s\S]*?classList\.toggle\('fx-unwired', !live\)/,
    'a tile whose slot binding does not match must render as unwired',
  );
});
