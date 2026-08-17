import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../docs/ui/touch_control.html'),
  'utf8',
);
const WIRE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../docs/ui/touch_control_wire.js'),
  'utf8',
);

test('legacy and Color Hub publish and consume one five-colour palette bus', () => {
  assert.match(PANEL_SOURCE, /function paint5\(list, sync\)/);
  assert.match(PANEL_SOURCE, /host\.dispatchEvent\(new CustomEvent\('palettechange'/);
  assert.match(PANEL_SOURCE, /function chShareRingWithLegacy\(source, skipPaletteWrite\)/);
  assert.match(PANEL_SOURCE, /function chAdoptLegacyRing\(event\)/);
  assert.match(
    PANEL_SOURCE,
    /sharedPaletteHost\.addEventListener\('palettechange', chAdoptLegacyRing\)/,
  );
});

test('every local Color Hub ring edit republishes the shared palette', () => {
  const calls = [...PANEL_SOURCE.matchAll(/chShareRingWithLegacy\('color-hub'/g)];
  assert.equal(calls.length, 3, 'hue, stage-only scheme and live restage must all share the ring');
});

test('daemon-confirmed palette adoption updates Legacy without a competing static write', () => {
  assert.match(PANEL_SOURCE, /chShareRingWithLegacy\('color-hub-broadcast', true\)/);
  assert.match(
    WIRE_SOURCE,
    /if \(!\(event\.detail && event\.detail\.skipPaletteWrite\)\) pushPalette\(\)/,
  );
  assert.match(WIRE_SOURCE, /pushEffectColours\(\);\s*pushMovementColours\(\);/);
});

test('legacy edits retune an active shared crossfade or turns transport', () => {
  assert.match(PANEL_SOURCE, /kind === 'crossfade' \|\| kind === 'turns'/);
  assert.match(PANEL_SOURCE, /chWrite\('PATCH', \{ palettes:/);
  assert.match(PANEL_SOURCE, /if \(kind !== 'none'\) detail\.skipPaletteWrite = true/);
});
