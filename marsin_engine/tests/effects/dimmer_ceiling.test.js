import assert from 'node:assert/strict';
import test from 'node:test';

import { IntensityController } from '../../lib/intensity_controller.js';

function overshootingPixel() {
  return { sId: 7, r: 2, g: 1.5, b: 1.2, w: 4, a: 3, u: 2.5 };
}

test('Dimmer Rack is an absolute ceiling after an over-range creative composite', () => {
  const controller = new IntensityController();
  controller.setSectionBrightness(7, 0.3);
  const pixels = [overshootingPixel()];
  controller.apply(pixels);
  for (const lane of ['r', 'g', 'b', 'w', 'a', 'u']) {
    assert.equal(pixels[0][lane], 0.3);
  }
});

test('explicit rack bypass policy still owns its lane', () => {
  const controller = new IntensityController();
  controller.setSectionBrightness(7, 0.3);
  const pixels = [overshootingPixel()];
  pixels[0].ignoreDimmerForRGB = true;
  controller.apply(pixels);
  assert.equal(pixels[0].r, 1);
  assert.equal(pixels[0].g, 1);
  assert.equal(pixels[0].b, 1);
  assert.equal(pixels[0].w, 0.3);
});
