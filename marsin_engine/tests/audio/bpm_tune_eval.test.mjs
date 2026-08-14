import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkGates, validateTierSelection } from '../../tools/bpm_tune_eval.mjs';

const TEMPOS = [60, 70, 75, 80, 90, 100, 110, 120, 124, 128, 140, 150, 160, 174];

function perfectRows() {
  return TEMPOS.map((bpm) => ({
    bpm,
    smoothed: bpm,
    errorFraction: 0,
    within1Pct: true,
    within2Pct: true,
    alias: null,
  }));
}

test('tier selection requires both clean and moderate regression evidence', () => {
  assert.doesNotThrow(() => validateTierSelection(['clean', 'moderate']));
  assert.doesNotThrow(() => validateTierSelection([
    'clean', 'moderate', 'heavy', 'adversarial',
  ]));
  assert.throws(() => validateTierSelection(['clean']), /missing moderate/);
  assert.throws(() => validateTierSelection(['moderate', 'heavy']), /missing clean/);
});

test('moderate fast tempos are gated individually, not hidden by the aggregate', () => {
  const clean = perfectRows();
  const moderate = perfectRows();
  const row174 = moderate.find(({ bpm }) => bpm === 174);
  row174.smoothed = 112.1;
  row174.errorFraction = Math.abs(row174.smoothed - row174.bpm) / row174.bpm;
  row174.within1Pct = false;
  row174.within2Pct = false;

  const failures = checkGates({
    clean: { steady: clean },
    moderate: { steady: moderate },
  });

  assert.equal(
    moderate.filter(({ within2Pct }) => within2Pct).length,
    13,
    'the aggregate still passes its 12/14 floor',
  );
  assert.ok(
    failures.some((failure) => failure.includes('moderate 174 BPM read 112.1')),
    `expected an individual moderate 174 BPM failure, got ${JSON.stringify(failures)}`,
  );
});

test('all clean and moderate gates pass on individually correct rows', () => {
  assert.deepEqual(checkGates({
    clean: { steady: perfectRows() },
    moderate: { steady: perfectRows() },
  }), []);
});
