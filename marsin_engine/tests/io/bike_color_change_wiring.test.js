import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineSource = fs.readFileSync(path.join(here, '..', '..', 'engine.js'), 'utf8');

test('Bike Link listens only to the shared ParamCenter and filters to actual global Color 1/2 changes', () => {
  assert.match(engineSource, /bikePaletteUnsubscribe\s*=\s*paramCenter\.subscribe/);
  assert.match(engineSource, /changedKeys\.includes\('colorPalette1'\)/);
  assert.match(engineSource, /changedKeys\.includes\('colorPalette2'\)/);
  assert.match(engineSource, /nextPalette\[key\]\[field\]\s*!==\s*lastBikePalette\[key\]\[field\]/);
  assert.match(engineSource, /bcs\.notifyPaletteChanged\(\)/);
  assert.doesNotMatch(engineSource, /liveTouchSession[^\n]*subscribe[^\n]*notifyPaletteChanged/);
});
test('shutdown unsubscribes the shared palette listener before stopping Bike Link', () => {
  const unsubscribeAt = engineSource.indexOf('bikePaletteUnsubscribe();');
  const stopAt = engineSource.indexOf('engineCore.bikeColorShare.stop();');
  assert.ok(unsubscribeAt > 0 && stopAt > unsubscribeAt);
});
