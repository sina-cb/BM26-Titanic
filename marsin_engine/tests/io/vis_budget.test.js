/**
 * vis_budget.test.js — the `/ws/viz` broadcast budget contract (report _239).
 *
 * Two things are pinned here:
 *
 *  1. VALIDATION IS LOUD. `vis:` is the one config block an operator is likely
 *     to hand-edit while chasing preview fidelity, and every mistake it can
 *     absorb silently (a typo'd field, a typo'd key, a string where a number
 *     belongs) is a mistake that shows up as "the window just never got
 *     sharper". Codex P0: absent ⇒ documented default; present-but-unreadable
 *     ⇒ throw, with the valid set named in the message.
 *
 *  2. THE SAMPLING RULE IS UNCHANGED per budget. CaptainPad's
 *     `sampleIndexForModelPixel` is the exact inverse of
 *     `floor(i * pixelCount / budget)`; if that formula ever drifts the Deck
 *     PIXELS window starts colouring pixels from the wrong strand and nothing
 *     visibly breaks. So the table is asserted directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import {
  VIS_COMPOSITE_KEYS,
  VIS_CONFIG_FIELDS,
  DEFAULT_BROADCAST_HZ,
  DEFAULT_MAX_PIXELS,
  resolveVisConfig,
  createVisSampler,
  describeVisPlan,
} from '../../lib/vis_budget.js';

/** The shipped titanic size — the number every fidelity claim is about. */
const TITANIC_PIXELS = 964;

describe('vis config — documented defaults when absent', () => {
  test('an empty block takes both defaults', () => {
    const plan = resolveVisConfig({});
    assert.equal(plan.broadcastHz, DEFAULT_BROADCAST_HZ);
    assert.equal(plan.defaultMaxPixels, DEFAULT_MAX_PIXELS);
    assert.equal(plan.keyMaxPixels.size, 0);
  });

  test('a missing block is the same as an empty one', () => {
    for (const absent of [undefined, null]) {
      const plan = resolveVisConfig(absent);
      assert.equal(plan.broadcastHz, DEFAULT_BROADCAST_HZ);
      assert.equal(plan.defaultMaxPixels, DEFAULT_MAX_PIXELS);
    }
  });

  test('intervalMs is derived from broadcastHz and never zero', () => {
    assert.equal(resolveVisConfig({ broadcastHz: 5 }).intervalMs, 200);
    assert.equal(resolveVisConfig({ broadcastHz: 1 }).intervalMs, 1000);
    // A pathological-but-legal rate still yields a usable timer period.
    assert.equal(resolveVisConfig({ broadcastHz: 100000 }).intervalMs, 1);
  });

  test('an unnamed key falls to the default budget — that IS the contract', () => {
    const plan = resolveVisConfig({ maxPixels: 64, keyMaxPixels: { rig: 'full' } });
    assert.equal(plan.budgetForKey('some_runtime_channel_id'), 64);
    assert.equal(plan.budgetForKey('master'), 64);
    assert.equal(plan.budgetForKey('rig'), Infinity);
  });
});

describe('vis config — refuses what it cannot read (no fallbacks)', () => {
  test('a non-mapping vis block throws', () => {
    assert.throws(() => resolveVisConfig(5), /vis must be a mapping/);
    assert.throws(() => resolveVisConfig([1, 2]), /vis must be a mapping/);
  });

  test('an unknown field throws and names the valid set', () => {
    assert.throws(
      () => resolveVisConfig({ maxPixel: 100 }),
      (err) => /unknown field vis\.maxPixel\b/.test(err.message)
        && VIS_CONFIG_FIELDS.every((f) => err.message.includes(f)),
    );
  });

  test('a non-positive or non-numeric broadcastHz throws', () => {
    for (const bad of [0, -1, '5', NaN, Infinity, null]) {
      assert.throws(() => resolveVisConfig({ broadcastHz: bad }), /vis\.broadcastHz/);
    }
  });

  test('maxPixels must be a positive integer or the literal full', () => {
    for (const bad of [0, -3, 2.5, '100', 'FULL', true, null]) {
      assert.throws(() => resolveVisConfig({ maxPixels: bad }), /vis\.maxPixels/);
    }
    assert.equal(resolveVisConfig({ maxPixels: 'full' }).defaultMaxPixels, Infinity);
    assert.equal(resolveVisConfig({ maxPixels: 1 }).defaultMaxPixels, 1);
  });

  test('keyMaxPixels must be a mapping', () => {
    for (const bad of ['full', 12, ['rig']]) {
      assert.throws(() => resolveVisConfig({ keyMaxPixels: bad }), /vis\.keyMaxPixels must be a mapping/);
    }
  });

  test('a mis-cased or invented key throws and lists the legal keys', () => {
    for (const bad of ['predimmer', 'Rig', 'deck', 'ch1', '']) {
      assert.throws(
        () => resolveVisConfig({ keyMaxPixels: { [bad]: 'full' } }),
        (err) => /is not a whole-rig vis key/.test(err.message)
          && VIS_COMPOSITE_KEYS.every((k) => err.message.includes(k)),
      );
    }
  });

  test('a bad per-key value throws naming that key', () => {
    for (const bad of [0, -4, 1.5, 'all', true]) {
      assert.throws(
        () => resolveVisConfig({ keyMaxPixels: { preDimmer: bad } }),
        /vis\.keyMaxPixels\.preDimmer/,
      );
    }
  });

  test('every composite key is individually accepted', () => {
    for (const key of VIS_COMPOSITE_KEYS) {
      const plan = resolveVisConfig({ keyMaxPixels: { [key]: 'full' } });
      assert.equal(plan.budgetForKey(key), Infinity);
    }
  });
});

describe('vis sampler — per-key budgets over one model', () => {
  const SHIPPED = { broadcastHz: 5, maxPixels: 100, keyMaxPixels: { rig: 'full', preDimmer: 'full' } };

  test('the shipped config gives channels 100 samples and the composites all 964', () => {
    const plan = resolveVisConfig(SHIPPED);
    const sampler = createVisSampler(TITANIC_PIXELS, plan);
    assert.equal(sampler.defaultOutputPixels(), 100);
    assert.equal(sampler.outputPixelsFor('a-runtime-channel-id'), 100);
    assert.equal(sampler.outputPixelsFor('master'), 100);
    assert.equal(sampler.outputPixelsFor('rig'), TITANIC_PIXELS);
    assert.equal(sampler.outputPixelsFor('preDimmer'), TITANIC_PIXELS);
  });

  test('a full-rate key is passed through WITHOUT copying', () => {
    const plan = resolveVisConfig(SHIPPED);
    const sampler = createVisSampler(TITANIC_PIXELS, plan);
    const full = new Uint8Array(TITANIC_PIXELS * 6);
    assert.equal(sampler.sample('rig', full), full, 'full rate must return the very same buffer');
  });

  test('a capped key reproduces floor(i * pixelCount / budget) exactly', () => {
    const plan = resolveVisConfig({ maxPixels: 100 });
    const sampler = createVisSampler(TITANIC_PIXELS, plan);
    // Paint each model pixel's index into its R byte (mod 256) so the sample
    // can be traced back to the source pixel it was read from.
    const full = new Uint8Array(TITANIC_PIXELS * 6);
    for (let i = 0; i < TITANIC_PIXELS; i++) full[i * 6] = i % 256;
    const out = sampler.sample('deck', full);
    assert.equal(out.length, 100 * 6);
    for (let i = 0; i < 100; i++) {
      const expectedSource = Math.floor(i * TITANIC_PIXELS / 100);
      assert.equal(out[i * 6], expectedSource % 256, `sample ${i} must come from pixel ${expectedSource}`);
    }
  });

  test('a model already under the budget is shipped verbatim', () => {
    const plan = resolveVisConfig({ maxPixels: 100 });
    const sampler = createVisSampler(40, plan);
    const full = new Uint8Array(40 * 6);
    assert.equal(sampler.outputPixelsFor('deck'), 40);
    assert.equal(sampler.sample('deck', full), full);
  });

  test('keys sharing a budget share one scratch buffer (and so must be encoded at once)', () => {
    const plan = resolveVisConfig({ maxPixels: 8 });
    const sampler = createVisSampler(64, plan);
    const a = new Uint8Array(64 * 6).fill(1);
    const b = new Uint8Array(64 * 6).fill(2);
    const outA = sampler.sample('chA', a);
    const outB = sampler.sample('chB', b);
    assert.equal(outA, outB, 'same budget ⇒ same scratch — this is why the caller encodes immediately');
    assert.equal(outB[0], 2);
  });

  test('different budgets do NOT share a scratch buffer', () => {
    const plan = resolveVisConfig({ maxPixels: 8, keyMaxPixels: { rig: 16 } });
    const sampler = createVisSampler(64, plan);
    const a = new Uint8Array(64 * 6).fill(1);
    const b = new Uint8Array(64 * 6).fill(2);
    const outCh = sampler.sample('chA', a);
    const outRig = sampler.sample('rig', b);
    assert.notEqual(outCh, outRig);
    assert.equal(outCh.length, 8 * 6);
    assert.equal(outRig.length, 16 * 6);
    assert.equal(outCh[0], 1, 'the channel buffer must survive the rig sample');
  });

  test('the sampler refuses a nonsense model size', () => {
    const plan = resolveVisConfig({});
    for (const bad of [0, -1, 2.5, NaN]) {
      assert.throws(() => createVisSampler(bad, plan), /positive integer pixelCount/);
    }
  });
});

describe('vis plan — the boot banner tells the truth', () => {
  test('it names the rate, the strip budget, and every raised key', () => {
    const plan = resolveVisConfig({ broadcastHz: 5, maxPixels: 100, keyMaxPixels: { rig: 'full', preDimmer: 'full' } });
    const line = describeVisPlan(plan, createVisSampler(TITANIC_PIXELS, plan), TITANIC_PIXELS);
    assert.match(line, /5 Hz/);
    assert.match(line, /100 px\/strip/);
    assert.match(line, /rig 964 \(full\)/);
    assert.match(line, /preDimmer 964 \(full\)/);
    assert.match(line, /model 964 px/);
  });

  test('a raised-but-still-capped key shows the ratio', () => {
    const plan = resolveVisConfig({ maxPixels: 100, keyMaxPixels: { rig: 240 } });
    const line = describeVisPlan(plan, createVisSampler(TITANIC_PIXELS, plan), TITANIC_PIXELS);
    assert.match(line, /rig 240\/964/);
  });

  test('with no overrides it says nothing about composites', () => {
    const plan = resolveVisConfig({ maxPixels: 100 });
    const line = describeVisPlan(plan, createVisSampler(TITANIC_PIXELS, plan), TITANIC_PIXELS);
    assert.doesNotMatch(line, /rig/);
    assert.doesNotMatch(line, /preDimmer/);
  });
});

describe('the shipped config.yaml is itself legal', () => {
  test('config.yaml → vis: resolves and raises rig + preDimmer to full rate', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(here, '..', '..', 'config.yaml');
    const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
    const plan = resolveVisConfig(doc.vis);
    assert.equal(plan.budgetForKey('rig'), Infinity);
    assert.equal(plan.budgetForKey('preDimmer'), Infinity);
    assert.ok(plan.defaultMaxPixels <= 256,
      'per-channel strips must stay cheap — one RN <View> per sample per channel');
  });
});
