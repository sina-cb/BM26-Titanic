/*
 * companion_party_tab.test.js — the PARTY tab's three load-bearing mechanisms
 * (report 20260725_19):
 *
 *   1. SURGICAL PERSIST into config.yaml's `party:` block. The regression this
 *      pins is real and expensive: a naive yaml.load→yaml.dump round-trip
 *      STRIPS EVERY COMMENT (it already destroyed the colorPalettes comments
 *      once). The tests byte-compare everything outside the changed scalars.
 *   2. The §6.2 CALIBRATION math (percentiles + the suggestion arithmetic).
 *   3. setParams APPLICATION through DerivedSignals, plus the read model the
 *      tab's meters render (getPartyStrongState).
 *
 * Run:  cd marsin_engine && node --test tests/companion/companion_party_tab.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PARTY_TUNABLES, PARTY_TUNABLE_KEYS, patchPartyBlock, persistPartyConfig,
  formatYamlScalar, percentile, calibrationSuggestions,
} from '../../audio/companion/party_tuning.js';
import {
  buildBpmTrackerOptions,
  buildDerivedSignalsOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { DerivedSignals } from '../../audio/signals/derived_signals.js';
import { PARTY_MODE_STRONG_DEFAULTS, PartyModeStrong } from '../../audio/signals/party_mode_strong.js';
import { ParamCenter } from '../../lib/param_center.js';

const ENGINE_DIR = path.resolve(import.meta.dirname, '..', '..');
const AUDIO_CONFIG = loadEffectiveAudioAnalysisConfig({
  engineDir: ENGINE_DIR,
  modelName: 'titanic',
}).audioConfig;

// A config.yaml shaped like the real one but DENSE with comments — inline,
// full-line, blank lines, a trailing comment on a key we edit, and neighbouring
// top-level blocks on both sides of `party:`.
const COMMENTED_CONFIG = `# marsin engine config — the operator's document.
sacn:
  priority: 100        # DMX priority
  # multicast is off on the playa LAN
  multicast: false

timeline:
  enabled: true
  mood:
    key: audioPartyStrong   # was audioParty
    staleSec: 10

# ── party detection (report 20260725_12 §2) ──────────────────────────────────
# ambientFloor is CALIBRATED ON PLAYA — do not guess it.
party:
  ambientFloor: 0.09      # quiet-night P95 of audioLoudness
  marginX: 2.5
  # the rhythmic evidence terms
  kickRateMin: 1.2
  kickRateMax: 3.2
  kickRegMin: 0.45
  requireBpmLock: true
  shapeLowMin: 0.2
  shapeHighMin: 0.12      # THE far-camp rejector
  silenceMax: 0.5
  onSustainMs: 20000
  offConfirmMs: 30000

# palettes below — these comments were destroyed once by a yaml round-trip.
colorPalettes:
  - id: laser_lime      # ★ operator favourite
    c1: 0.28
`;

/** Every line that is NOT one of the edited keys, for the byte-compare. */
function linesExcept(text, keys) {
  return text.split('\n').filter((l) => !keys.some((k) => new RegExp(`^\\s*${k}:`).test(l)));
}

// ── 1. surgical persist ──────────────────────────────────────────────────────

test('persist replaces ONLY the value — every comment and every other byte survives', () => {
  const out = patchPartyBlock(COMMENTED_CONFIG, { ambientFloor: 0.0042, marginX: 3.75 });

  // Every line except the two edited ones is byte-identical, in the same order.
  assert.deepEqual(
    linesExcept(out, ['ambientFloor', 'marginX']),
    linesExcept(COMMENTED_CONFIG, ['ambientFloor', 'marginX']),
    'a non-edited line changed — the write is not surgical',
  );
  // The comments that a yaml round-trip would have destroyed:
  for (const comment of [
    "# marsin engine config — the operator's document.",
    '# ambientFloor is CALIBRATED ON PLAYA — do not guess it.',
    '  # the rhythmic evidence terms',
    '# palettes below — these comments were destroyed once by a yaml round-trip.',
    '    c1: 0.28',
  ]) {
    assert.ok(out.includes(comment), `lost: ${comment}`);
  }
  // The edited lines keep their indentation AND their trailing comment.
  assert.ok(out.includes('  ambientFloor: 0.0042      # quiet-night P95 of audioLoudness'),
    'trailing comment or indentation lost on the edited line');
  assert.ok(out.includes('  marginX: 3.75'));
  // Nothing outside party: moved.
  assert.ok(out.includes('    key: audioPartyStrong   # was audioParty'));
  assert.ok(out.includes('    - id: laser_lime      # ★ operator favourite')
    || out.includes('  - id: laser_lime      # ★ operator favourite'));
});

test('persist handles a boolean tunable and a key with a trailing comment', () => {
  const out = patchPartyBlock(COMMENTED_CONFIG, { requireBpmLock: false, shapeHighMin: 0.3 });
  assert.ok(out.includes('  requireBpmLock: false'));
  assert.ok(out.includes('  shapeHighMin: 0.3      # THE far-camp rejector'),
    'the far-camp rejector comment must survive its own edit');
  assert.deepEqual(
    linesExcept(out, ['requireBpmLock', 'shapeHighMin']),
    linesExcept(COMMENTED_CONFIG, ['requireBpmLock', 'shapeHighMin']),
  );
});

test('persist FAILS LOUD when a key line is not in the block — and writes nothing', () => {
  const withoutKey = COMMENTED_CONFIG.replace(/^ {2}silenceMax: .*$\n/m, '');
  assert.throws(
    () => patchPartyBlock(withoutKey, { silenceMax: 0.4 }),
    /key "silenceMax" not found in the party: block/,
  );
  // And on disk: the file is untouched after the throw.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partycfg-'));
  const p = path.join(dir, 'config.yaml');
  fs.writeFileSync(p, withoutKey, 'utf8');
  assert.throws(() => persistPartyConfig(p, { silenceMax: 0.4 }), /not found/);
  assert.equal(fs.readFileSync(p, 'utf8'), withoutKey, 'the file was modified despite the failure');
});

test('persist refuses an unknown key, a missing block, and a duplicate block', () => {
  assert.throws(() => patchPartyBlock(COMMENTED_CONFIG, { nope: 1 }), /not a party tunable/);
  assert.throws(() => patchPartyBlock('sacn:\n  priority: 100\n', { marginX: 2 }),
    /no top-level "party:" block/);
  assert.throws(() => patchPartyBlock(COMMENTED_CONFIG + '\nparty:\n  marginX: 9\n', { marginX: 2 }),
    /2 top-level "party:" blocks/);
});

test('persist round-trips through the filesystem and re-parses to the new values', async () => {
  const yaml = (await import('js-yaml')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partycfg-'));
  const p = path.join(dir, 'config.yaml');
  fs.writeFileSync(p, COMMENTED_CONFIG, 'utf8');
  persistPartyConfig(p, { ambientFloor: 0.0031, marginX: 4, requireBpmLock: false, onSustainMs: 20000 });
  const parsed = yaml.load(fs.readFileSync(p, 'utf8'));
  assert.equal(parsed.party.ambientFloor, 0.0031);
  assert.equal(parsed.party.marginX, 4);
  assert.equal(parsed.party.requireBpmLock, false);
  assert.equal(parsed.party.onSustainMs, 20000);
  // The neighbouring blocks are intact and still parse.
  assert.equal(parsed.timeline.mood.key, 'audioPartyStrong');
  assert.equal(parsed.colorPalettes[0].id, 'laser_lime');
});

test('a value that would serialize in exponent form is REFUSED, not written', () => {
  assert.throws(() => formatYamlScalar('ambientFloor', 1e-7), /exponent form/);
  assert.throws(() => formatYamlScalar('requireBpmLock', 1), /must be a boolean/);
  assert.throws(() => formatYamlScalar('marginX', Number.NaN), /finite number/);
});

test('the tunable spec covers exactly the config.yaml party: keys from report _12 §2', () => {
  assert.deepEqual([...PARTY_TUNABLE_KEYS].sort(), [
    'ambientFloor', 'kickRateMax', 'kickRateMin', 'kickRegMin', 'marginX',
    'offConfirmMs', 'onSustainMs', 'requireBpmLock', 'shapeHighMin', 'shapeLowMin', 'silenceMax',
  ]);
  // Every editable key must be a REAL detector tunable, or APPLY would throw.
  for (const k of PARTY_TUNABLE_KEYS) {
    assert.ok(k in PARTY_MODE_STRONG_DEFAULTS, `${k} is not a PartyModeStrong tunable`);
  }
  for (const t of PARTY_TUNABLES) {
    assert.ok(t.label && t.hint, `${t.key} needs a label + hint for the editor`);
  }
});

// ── 2. calibration math (report _12 §6.2) ────────────────────────────────────

test('percentile is linear-interpolated and order-independent', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(v, 0), 1);
  assert.equal(percentile(v, 100), 10);
  assert.equal(percentile(v, 50), 5.5);
  // idx = 9 * 0.95 = 8.55 → 9 + 0.55*(10-9)
  assert.ok(Math.abs(percentile(v, 95) - 9.55) < 1e-9);
  assert.equal(percentile([...v].reverse(), 50), 5.5, 'input order must not matter');
  assert.equal(percentile([0.7], 95), 0.7, 'a single sample is its own percentile');
});

test('percentile fails loud on an empty capture and a bad p', () => {
  assert.throws(() => percentile([], 95), /recorded nothing/);
  assert.throws(() => percentile([1, 2], 101), /must be 0\.\.100/);
  assert.throws(() => percentile([1, Number.NaN], 50), /non-finite sample/);
});

test('suggestions implement the report §6.2 arithmetic', () => {
  // ambientFloor = P95(ambient); marginX = 0.5 × (P5(party) / P95(ambient))
  const s = calibrationSuggestions({ ambientP95: 0.02, partyP5: 0.3 });
  assert.equal(s.ambientFloor, 0.02);
  assert.ok(Math.abs(s.marginX - 7.5) < 1e-12);
  assert.equal(s.kickRegMin, undefined, 'no kickReg captured ⇒ no kickReg suggestion');
  // kickRegMin = min(0.45, 0.8 × typical party kickReg) — only lowers it.
  assert.equal(calibrationSuggestions({ ambientP95: 0.02, partyP5: 0.3, partyKickReg: 0.99 }).kickRegMin, 0.45);
  const low = calibrationSuggestions({ ambientP95: 0.02, partyP5: 0.3, partyKickReg: 0.4 });
  assert.ok(Math.abs(low.kickRegMin - 0.32) < 1e-12);
});

test('suggestions are null with only one capture — never a half-guess', () => {
  assert.equal(calibrationSuggestions({ ambientP95: 0.02, partyP5: null }), null);
  assert.equal(calibrationSuggestions({ ambientP95: null, partyP5: 0.3 }), null);
  assert.throws(() => calibrationSuggestions({ ambientP95: 0, partyP5: 0.3 }), /must be > 0/);
});

// ── 3. setParams application + the meter read model ──────────────────────────

function makeDerived() {
  const pc = new ParamCenter(null);
  return new DerivedSignals({
    paramCenter: pc,
    bpmTracker: buildBpmTrackerOptions(AUDIO_CONFIG),
    derivedSignals: buildDerivedSignalsOptions(AUDIO_CONFIG),
  });
}

test('APPLY reaches the live detector and is readable back', () => {
  const d = makeDerived();
  assert.equal(d.getPartyStrongParams().ambientFloor, PARTY_MODE_STRONG_DEFAULTS.ambientFloor);
  d.setPartyStrongParams({ ambientFloor: 0.004, marginX: 3.2, requireBpmLock: false });
  const p = d.getPartyStrongParams();
  assert.equal(p.ambientFloor, 0.004);
  assert.equal(p.marginX, 3.2);
  assert.equal(p.requireBpmLock, false);
  // untouched keys keep their values
  assert.equal(p.onSustainMs, PARTY_MODE_STRONG_DEFAULTS.onSustainMs);
});

test('APPLY rejects a typo / bad type loudly and changes nothing after the throw', () => {
  const d = makeDerived();
  assert.throws(() => d.setPartyStrongParams({ ambienFloor: 0.1 }), /unknown tunable/);
  assert.throws(() => d.setPartyStrongParams({ requireBpmLock: 'yes' }), /must be a boolean/);
  assert.throws(() => d.setPartyStrongParams({ marginX: 'loud' }), /must be a finite number/);
  assert.equal(d.getPartyStrongParams().marginX, PARTY_MODE_STRONG_DEFAULTS.marginX);
});

test('VALIDATION MODE semantics: onSustainMs → 3000 and back, nothing else moves', () => {
  const d = makeDerived();
  const saved = d.getPartyStrongParams().onSustainMs;
  d.setPartyStrongParams({ onSustainMs: 3000 });
  assert.equal(d.getPartyStrongParams().onSustainMs, 3000);
  d.setPartyStrongParams({ onSustainMs: saved });
  assert.deepEqual(d.getPartyStrongParams(), { ...PARTY_MODE_STRONG_DEFAULTS });
});

test('the meter read model reports thresholds, verdicts and debounce progress', () => {
  const gate = new PartyModeStrong({ ambientFloor: 0.01, marginX: 2, onSustainMs: 5000, warmupMs: 0 });
  const st0 = gate.getState(0);
  assert.equal(st0.levelThreshold, 0.02, 'threshold = ambientFloor × marginX (the marker line)');
  assert.equal(st0.qualifyingForMs, 0);
  assert.equal(st0.disqualifyingForMs, 0);
  assert.deepEqual(st0.params, gate.p, 'the tab reads the live tunables from the same snapshot');

  // Feed a qualifying 128 BPM-ish beat: kicks every 469 ms, full-band content.
  let now = 0;
  const dt = 512 / 44100;
  let nextKick = 0;
  for (let i = 0; i < 700; i++) {
    now += dt * 1000;
    let kick = 0;
    if (now >= nextKick) { kick = 1; nextKick = now + 469; }
    gate.update({ low: 0.6, mid: 0.4, high: 0.25, kick, silence: 0, bpmLocked: true, dt, nowMs: now });
  }
  const st = gate.getState(now);
  assert.equal(st.qualify, true, 'the synthetic beat must qualify');
  assert.ok(st.qualifyingForMs > 0, 'debounce progress must be reported while qualifying');
  assert.equal(st.disqualifyingForMs, 0, 'only one debounce anchor is ever live');
  assert.equal(st.party, true, 'onSustainMs 5 s elapsed → the gate latched ON');
  assert.ok(st.levelOk && st.beatOk && st.shapeOk && st.quietOk);
  assert.equal(st.warmedUp, true);
  assert.throws(() => gate.getState(Number.NaN), /must be finite/);
});
