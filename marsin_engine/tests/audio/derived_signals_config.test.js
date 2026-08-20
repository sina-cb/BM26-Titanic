import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildBpmTrackerOptions,
  buildDerivedSignalsOptions,
} from '../../audio/config/audio_analysis_config.js';
import { mergeAudioConfig, pickLiveFields, validateLivePatch } from '../../audio/config/audio_config.js';
import {
  DERIVED_SIGNALS_DEFAULTS,
  mergeDerivedSignalsConfig,
  validateDerivedSignalsConfig,
} from '../../audio/config/derived_signals_config.js';
import { DerivedSignals } from '../../audio/signals/derived_signals.js';
import { ParamCenter } from '../../lib/param_center.js';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
// HERMETIC: tracked config.yaml only. The first test asserts the SHIPPED
// derived config equals DERIVED_SIGNALS_DEFAULTS — a claim about config.yaml.
// The scene state persists every derived group the operator live-patches
// through the Companion, so on the effective config that assertion would go red
// on a knob turn rather than on a real drift.
// See tests/helpers/tracked_audio_config.mjs.
const AUDIO_CONFIG = loadTrackedAudioAnalysisConfig(ENGINE_DIR);

function makeDerived() {
  return new DerivedSignals({
    paramCenter: new ParamCenter(null),
    bpmTracker: buildBpmTrackerOptions(AUDIO_CONFIG),
    derivedSignals: buildDerivedSignalsOptions(AUDIO_CONFIG),
  });
}

test('shipped derived config is explicit and exactly matches canonical tuned defaults', () => {
  assert.deepEqual(buildDerivedSignalsOptions(AUDIO_CONFIG), DERIVED_SIGNALS_DEFAULTS);
  assert.equal(validateDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals), AUDIO_CONFIG.derivedSignals);
});

test('derived config fails loudly on missing, unknown, non-finite, and invalid ordering', () => {
  const missing = buildDerivedSignalsOptions(AUDIO_CONFIG);
  delete missing.party.onThresh;
  assert.throws(() => validateDerivedSignalsConfig(missing), /party\.onThresh/);

  const unknown = buildDerivedSignalsOptions(AUDIO_CONFIG);
  unknown.party.magic = 1;
  assert.throws(() => validateDerivedSignalsConfig(unknown), /unknown field "magic"/);

  assert.throws(
    () => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, {
      trackChange: { silenceConfirmMs: Number.NaN },
    }),
    /finite number/,
  );
  assert.throws(
    () => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, {
      trackChange: { offThresh: 0.3 },
    }),
    /offThresh < onThresh/,
  );
  assert.throws(
    () => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, {
      noteColors: { c: 1 },
    }),
    /noteColors\.c must be in \[0, 1\)/,
  );
});

test('noteTracking bounds are MUSICAL: degenerate values cannot disable or freeze the note', () => {
  const bad = (patch, pattern) => assert.throws(
    () => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, { noteTracking: patch }),
    pattern,
  );
  // Evidence window: too short to hold a majority / too long to resolve a chord.
  bad({ medianN: 2 }, /medianN must be in \[3, 51\]/);
  bad({ medianN: 52 }, /medianN must be in \[3, 51\]/);
  bad({ medianN: 15.5 }, /medianN must be an integer in \[3, 51\]/);
  // Consensus below one third is not consensus — a three-way tie would commit.
  bad({ minConsensus: 0.33 }, /minConsensus must be in \[0\.34, 1\]/);
  bad({ minConsensus: 1.01 }, /minConsensus must be in \[0\.34, 1\]/);
  // Zero hysteresis = strobing hue; 200 / 400 hops (≈2.3 s / ≈4.6 s at the
  // shipped 86.13 hops/s) is the "never lands inside a phrase" ceiling.
  bad({ holdHops: 0 }, /holdHops must be in \[1, 200\]/);
  bad({ holdHops: 201 }, /holdHops must be in \[1, 200\]/);
  bad({ nearHoldHops: 0 }, /nearHoldHops must be in \[1, 400\]/);
  bad({ nearHoldHops: 401 }, /nearHoldHops must be in \[1, 400\]/);
  // Cross-check: the AMBIGUOUS near move may never be cheaper than a far move.
  bad({ nearHoldHops: 9 }, /requires nearHoldHops >= holdHops/);
  bad({ holdHops: 25 }, /requires nearHoldHops >= holdHops/);
  assert.doesNotThrow(() => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, {
    noteTracking: { nearHoldHops: AUDIO_CONFIG.derivedSignals.noteTracking.holdHops },
  }), 'nearHoldHops === holdHops is legal (>=, not >)');
  // The old "medianN must be odd" rule is GONE: the estimator takes the
  // histogram MODE with an explicit tie-break, so window parity is meaningless.
  assert.doesNotThrow(() => mergeDerivedSignalsConfig(AUDIO_CONFIG.derivedSignals, {
    noteTracking: { medianN: 16 },
  }), 'an even evidence window is well-defined for a mode filter');
});

test('live patch accepts operator fields, rejects fixed weights, and persists deeply', () => {
  const valid = validateLivePatch({
    derivedSignals: { trackChange: { silenceConfirmMs: 700 } },
  });
  assert.equal(valid.ok, true, valid.error);
  assert.deepEqual(valid.live, {
    derivedSignals: { trackChange: { silenceConfirmMs: 700 } },
  });
  assert.equal(valid.requiresCaptureRestart, false);

  const noteColor = validateLivePatch({ derivedSignals: { noteColors: { cSharp: 0.91 } } });
  assert.equal(noteColor.ok, true, noteColor.error);
  assert.equal(noteColor.live.derivedSignals.noteColors.cSharp, 0.91);

  const fixedWeight = validateLivePatch({ derivedSignals: { party: { wLow: 0.5 } } });
  assert.equal(fixedWeight.ok, false);
  assert.match(fixedWeight.error, /not live-tunable/);

  const merged = mergeAudioConfig(AUDIO_CONFIG, valid.live);
  assert.equal(merged.derivedSignals.trackChange.silenceConfirmMs, 700);
  assert.equal(
    merged.derivedSignals.trackChange.changeRefractoryMs,
    AUDIO_CONFIG.derivedSignals.trackChange.changeRefractoryMs,
  );
  // pickLiveFields deliberately does NOT project derivedSignals wholesale: a
  // scene only persists the groups actually live-patched this session, so an
  // untouched group keeps following config.yaml.
  assert.equal(pickLiveFields(merged).derivedSignals, undefined);
  const projected = pickLiveFields(merged, { derivedSignalsGroups: ['trackChange'] });
  assert.deepEqual(Object.keys(projected.derivedSignals), ['trackChange']);
  assert.equal(projected.derivedSignals.trackChange.silenceConfirmMs, 700);
  assert.equal(projected.derivedSignals.trackChange.wLow, undefined,
    'fixed band weights are not live-tunable and must not be persisted');
});

test('DerivedSignals requires canonical config and atomically replaces only the touched module', () => {
  assert.throws(
    () => new DerivedSignals({
      paramCenter: new ParamCenter(null),
      bpmTracker: buildBpmTrackerOptions(AUDIO_CONFIG),
    }),
    /audio\.derivedSignals/,
  );

  const derived = makeDerived();
  const originalParty = derived._party;
  const originalNote = derived._note;
  const originalTrackChange = derived._trackChange;
  const originalConfig = derived.getConfig();
  assert.throws(
    () => derived.reconfigure('party', { onThresh: 0.05 }),
    /offThresh < onThresh/,
  );
  assert.equal(derived._party, originalParty, 'rejected patch does not replace party state');
  assert.deepEqual(derived.getConfig(), originalConfig, 'rejected patch does not mutate config');

  const next = derived.reconfigure('party', { onThresh: 0.3 });
  assert.notEqual(derived._party, originalParty, 'touched party module starts fresh');
  assert.equal(derived._trackChange, originalTrackChange, 'untouched detector retains state');
  assert.equal(next.party.onThresh, 0.3);
  const noteNext = derived.reconfigure('noteTracking', { holdHops: 12 });
  assert.notEqual(derived._note, originalNote, 'note tuning starts a fresh estimator');
  assert.equal(noteNext.noteTracking.holdHops, 12);
  assert.deepEqual(derived.getMetrics(), { partyLoudness: 0, silenceLoudness: 0 });
});
