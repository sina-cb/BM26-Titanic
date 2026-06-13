/**
 * mic_model.test.mjs — deterministic unit guard for the virtual playa mic.
 * No audio files, no network: synthetic Int16 input only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyMicModel, MIC_TIERS, degradeClip } from './mic_model.mjs';

function tone(n, freq = 200, sr = 44100, amp = 0.5) {
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin(2 * Math.PI * freq * i / sr) * amp * 32767);
  return s;
}

test('determinism: same (seed,tier) → byte-identical output', () => {
  const src = tone(44100);
  const a = applyMicModel(src, 44100, { tier: 'moderate', seed: 123 });
  const b = applyMicModel(src, 44100, { tier: 'moderate', seed: 123 });
  assert.deepEqual(Array.from(a.samples), Array.from(b.samples));
});

test('different seed → different noise realization', () => {
  const src = tone(44100);
  const a = applyMicModel(src, 44100, { tier: 'moderate', seed: 1 });
  const b = applyMicModel(src, 44100, { tier: 'moderate', seed: 2 });
  assert.notDeepEqual(Array.from(a.samples), Array.from(b.samples));
});

test('SNR decreases clean → moderate → heavy; noise floor increases', () => {
  const src = tone(44100 * 2);
  const clean = applyMicModel(src, 44100, { tier: 'clean', seed: 7 }).meta;
  const mod = applyMicModel(src, 44100, { tier: 'moderate', seed: 7 }).meta;
  const heavy = applyMicModel(src, 44100, { tier: 'heavy', seed: 7 }).meta;
  assert.ok(clean.measuredSnrDb > mod.measuredSnrDb, `clean ${clean.measuredSnrDb} > mod ${mod.measuredSnrDb}`);
  assert.ok(mod.measuredSnrDb > heavy.measuredSnrDb, `mod ${mod.measuredSnrDb} > heavy ${heavy.measuredSnrDb}`);
  assert.ok(heavy.noiseRms > mod.noiseRms && mod.noiseRms > clean.noiseRms);
});

test('targeted tiers hit their SNR within ~1.5 dB', () => {
  const src = tone(44100 * 2, 300, 44100, 0.6);
  for (const tier of ['moderate', 'heavy']) {
    const m = applyMicModel(src, 44100, { tier, seed: 9 }).meta;
    assert.ok(Math.abs(m.measuredSnrDb - MIC_TIERS[tier].snrDb) < 1.5,
      `${tier}: measured ${m.measuredSnrDb.toFixed(1)} vs target ${MIC_TIERS[tier].snrDb}`);
  }
});

test('output is Int16Array, same length, never clips out of range, all finite', () => {
  const src = tone(10000, 60, 44100, 0.95);
  const { samples } = applyMicModel(src, 44100, { tier: 'heavy', seed: 3 });
  assert.ok(samples instanceof Int16Array);
  assert.equal(samples.length, src.length);
  for (let i = 0; i < samples.length; i++) {
    assert.ok(samples[i] >= -32767 && samples[i] <= 32767 && Number.isFinite(samples[i]));
  }
});

test('fail-loud on bad input (codex P0)', () => {
  assert.throws(() => applyMicModel([1, 2, 3], 44100, {}), /Int16Array/);
  assert.throws(() => applyMicModel(tone(100), 0, {}), /sampleRate/);
  assert.throws(() => applyMicModel(tone(100), 44100, { tier: 'nope' }), /unknown tier/);
});

test('degradeClip preserves clip shape + attaches micMeta', () => {
  const clip = { name: 't', sampleRate: 44100, samples: tone(2000), labels: { drops: [], regions: [] } };
  const out = degradeClip(clip, { tier: 'moderate', seed: 5 });
  assert.equal(out.name, 't');
  assert.equal(out.samples.length, 2000);
  assert.ok(out.micMeta && out.micMeta.tier === 'moderate');
});
