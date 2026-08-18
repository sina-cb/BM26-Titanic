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

function functionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

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
    /pushPalette\(false, !!\(event\.detail && event\.detail\.skipPaletteWrite\)\)/,
  );
  assert.match(
    functionSource(WIRE_SOURCE, 'pushPalette'),
    /if \(!skipEnginePair\)[\s\S]*\[3, 4, 5\]\.forEach/,
    'daemon frames skip their duplicate CPC pair but still reach five-colour local exports',
  );
  assert.match(WIRE_SOURCE, /pushEffectColours\(\);\s*pushMovementColours\(\);/);
});

test('legacy edits retune an active shared crossfade or turns transport', () => {
  assert.match(PANEL_SOURCE, /kind === 'crossfade' \|\| kind === 'turns'/);
  assert.match(PANEL_SOURCE, /chWrite\('PATCH', \{ palettes:/);
  assert.match(PANEL_SOURCE, /if \(kind !== 'none'\) detail\.skipPaletteWrite = true/);
});

test('GLOBAL palette authority never creates an opaque post-pattern fixed-color layer', () => {
  const desiredStatic = functionSource(WIRE_SOURCE, 'desiredStatic');
  assert.match(desiredStatic, /m\.own/, 'explicit OWN remains the fixed-color authority');
  assert.doesNotMatch(
    desiredStatic,
    /m\.global|pal\[|anyEffectChosen/,
    'GLOBAL must feed pattern palette inputs, never group-fixed-color output',
  );
  assert.match(
    functionSource(WIRE_SOURCE, 'applyStatic'),
    /'DELETE', '\/group-fixed-colors\/'/,
    'the corrected policy must actively remove stale implicit overrides',
  );
});

test('Live Touch Color loads the same nine-scheme domain as Deck before page logic', () => {
  assert.match(
    PANEL_SOURCE,
    /CaptainPad\/shared\/color_control_core_browser\.js/,
    'the offline shared browser adapter must be loaded by the panel',
  );
  assert.match(PANEL_SOURCE, /window\.ColorControlCore/);
  assert.doesNotMatch(
    PANEL_SOURCE,
    /var CH_SCHEME_IDS = \[[^\]]+\]/,
    'Color Hub must not retain a private four-scheme catalog',
  );
  assert.doesNotMatch(
    PANEL_SOURCE,
    /function chGenerateScheme\(/,
    'Color Hub must delegate scheme generation to the shared domain',
  );
});
