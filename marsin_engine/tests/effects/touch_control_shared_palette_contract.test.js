import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control.html'),
  'utf8',
);
const WIRE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js'),
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
  assert.equal(calls.length, 4,
    'hue, scheme stage/restage, and A/B selection must all share the ring');
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
  const paletteChange = WIRE_SOURCE.match(/slotsEl\.addEventListener\('palettechange'[\s\S]*?\n  \}\);/);
  assert.ok(paletteChange, 'palettechange handler must exist');
  assert.match(paletteChange[0], /pushPalette\(false/,
    'wheel edits must refresh the session-owned overlay palette');
  assert.match(paletteChange[0], /pushEffectColours\(\)/,
    'wheel edits may still recolour any future colour-capable effect slots');
  assert.doesNotMatch(paletteChange[0], /pushMovementColours\(/,
    'movementTrace colours are session-owned — wheel edits must not patch slot params');
  assert.doesNotMatch(WIRE_SOURCE, /pushMovementColours\(/,
    'movementTrace must never route wheel colours through slot paramsOverride.colors');
});

test('pushPalette publishes the staged wheel colours to the private session palette endpoint', () => {
  const pushPaletteSrc = functionSource(WIRE_SOURCE, 'pushPalette');
  assert.match(pushPaletteSrc, /readPublishedFivePalette\(\)/,
    'pushPalette must read the exact five colours shown on the wheel');
  assert.match(pushPaletteSrc,
    /strictWrite\('POST', '\/layers\/live_touch\/palette', \{ colorPalette: pal \}\)/,
    'atomic ARM must stage the private overlay palette from the wheel');
  assert.match(pushPaletteSrc,
    /pushOverlayPalette\(pal\)/,
    'armed wheel moves must update the private overlay palette');
  assert.doesNotMatch(pushPaletteSrc, /paramsOverride\.colors/,
    'session palette staging must not synthesize slot colour overrides');
});

test('crossfade broadcast adoption keeps the staged five-slot ring intact', () => {
  assert.match(PANEL_SOURCE, /orbit\.ring\.length === 2/);
  assert.match(PANEL_SOURCE, /paint5 requires exactly five colours/);
  assert.match(PANEL_SOURCE, /chAttachLivePalettes/);
  assert.match(PANEL_SOURCE, /buildLivePalettesFromPairs/);
});

test('A/B selection drives output order and live retargets without pattern ids', () => {
  assert.match(PANEL_SOURCE, /paletteSelection/);
  assert.match(PANEL_SOURCE, /outputPaletteFromSelection/);
  assert.match(PANEL_SOURCE, /candidatePaletteFromOutput/);
  assert.match(functionSource(PANEL_SOURCE, 'chAssignSwatch'),
    /kind === 'crossfade' \|\| kind === 'turns'[\s\S]*chBuildPaletteRestagePatch/);
  assert.match(functionSource(WIRE_SOURCE, 'applyCapability'),
    /sliderHue3[\s\S]*sliderVal5[\s\S]*outputSlots/);
  assert.doesNotMatch(functionSource(WIRE_SOURCE, 'applyCapability'), /PATTERN_FILES|patternId/);
});

test('FOLLOW NOTE exposes engine-derived five samples and live A/B retuning', () => {
  assert.match(PANEL_SOURCE, /id="chRingFollow"/);
  assert.match(PANEL_SOURCE, /id="chArmAFollow"/);
  assert.match(PANEL_SOURCE, /id="chArmBFollow"/);
  assert.match(functionSource(PANEL_SOURCE, 'chAssignFollowSwatch'),
    /chWrite\('PATCH', \{ followNote: \{ sel:/);
  assert.match(functionSource(PANEL_SOURCE, 'chHydrateBroadcastTuning'),
    /chGenerateScheme\(b\.currentScheme, b\.noteHue\)/);
  assert.match(WIRE_SOURCE, /addEventListener\('livefollowpalette'/);
});

test('legacy edits restage parallel pair and five-colour targets on an active transport', () => {
  assert.match(PANEL_SOURCE, /kind === 'crossfade' \|\| kind === 'turns'/);
  assert.match(PANEL_SOURCE, /chWrite\('PATCH', chBuildPaletteRestagePatch\(kind\)/);
  assert.match(
    functionSource(PANEL_SOURCE, 'chBuildPaletteRestagePatch'),
    /palettes: full\.palettes,[\s\S]*livePalettes: full\.livePalettes/,
  );
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
    /\.\.\/shared\/color_control_core_browser\.js/,
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
