import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkGates,
  evalAudioConfig,
  validateTierSelection,
} from '../../tools/bpm_tune_eval.mjs';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ENGINE_DIR, 'config.yaml');
const TOOL_PATH = path.join(ENGINE_DIR, 'tools', 'bpm_tune_eval.mjs');

const TEMPOS = [60, 70, 75, 80, 90, 100, 110, 120, 124, 128, 140, 150, 160, 174];

/**
 * The `minBpm 60 vs 70` A/B published in `config.yaml`'s `bpmTracker` comment.
 * THIRD WITNESS (the `_204` parity idiom): the numbers live here as well as in
 * the comment, so "make the comment say something" cannot be satisfied by
 * editing the comment alone. Re-measured by `_214` on the TRACKED config —
 * `node tools/bpm_tune_eval.mjs --opts '{"minBpm":60}'` — and reproduced to the
 * decimal (moderate 174 → 112.1, heavy 124 → 96.4). They do NOT reproduce on
 * the operator's live overlay: at `bands.inputGain 9.1` the moderate 174 row
 * reads 173.3 (−0.4%) and the documented failure vanishes, which is precisely
 * why the evaluator now defaults to tracked config.
 */
const PUBLISHED_MIN_BPM_AB = Object.freeze([
  { label: 'moderate 174', pattern: /moderate 174 → (\d+) \((-?\d+\.\d)%\)/, bpm: '112', errorPct: '-35.6' },
  { label: 'heavy 124', pattern: /heavy 124 → (\d+) \((-?\d+\.\d)%\)/, bpm: '96', errorPct: '-22.3' },
]);

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

// ── Hermeticity (report _214) ───────────────────────────────────────────────
// This file IMPORTS the evaluator, so whatever config the evaluator resolves at
// module load is config this gate is transitively coupled to. It used to be
// `loadEffectiveAudioAnalysisConfig({modelName:'titanic'})` — config.yaml with
// the operator's live scene overlay merged over it.

test('the evaluator is scored on the tracked config, with no scene-state overlay', () => {
  assert.deepEqual(
    evalAudioConfig(),
    loadTrackedAudioAnalysisConfig(ENGINE_DIR),
    `bpm_tune_eval must resolve exactly ${CONFIG_PATH}, with no states/<scene>/ overlay`,
  );
});

test('a planted scene overlay cannot reach the evaluator (only --effective can)', () => {
  // The regression lock. `MARSIN_STATE_DIR` points at a fixture root carrying a
  // gain no config.yaml would ship; if someone re-adds the effective loader at
  // module scope, the child reports 12.5 and this fails loudly.
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26-bpm-eval-overlay-'));
  try {
    for (const scene of ['titanic', 'test_bench']) {
      fs.mkdirSync(path.join(stateRoot, scene), { recursive: true });
      fs.writeFileSync(
        path.join(stateRoot, scene, 'audio_state.yaml'),
        'bands:\n  inputGain: 12.5\n',
        'utf8',
      );
    }
    // A probe FILE rather than `-e`: the tool's `isMainModule()` guard reads
    // `process.argv[1]`, which `-e` leaves empty (it throws, by design).
    const probePath = path.join(stateRoot, 'probe.mjs');
    fs.writeFileSync(
      probePath,
      `import { evalAudioConfig } from ${JSON.stringify(pathToFileURL(TOOL_PATH).href)};\n`
      + 'process.stdout.write(String(evalAudioConfig().bands.inputGain));\n',
      'utf8',
    );
    const probe = spawnSync(process.execPath, [probePath], {
      cwd: ENGINE_DIR,
      env: { ...process.env, MARSIN_STATE_DIR: stateRoot },
      encoding: 'utf8',
    });
    assert.equal(probe.status, 0, `probe failed: ${probe.stderr}`);
    assert.notEqual(
      probe.stdout, '12.5',
      `bpm_tune_eval read the scene-state overlay under ${stateRoot} — the gate is `
      + 'state-coupled again (see the TRACKED_AUDIO block in tools/bpm_tune_eval.mjs)',
    );
    assert.equal(
      probe.stdout,
      String(loadTrackedAudioAnalysisConfig(ENGINE_DIR).bands.inputGain),
      `bpm_tune_eval must report the tracked gain from ${CONFIG_PATH}`,
    );
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('the published minBpm A/B figures in config.yaml match the measured ones', () => {
  const configText = fs.readFileSync(CONFIG_PATH, 'utf8');
  // Flatten the wrapped YAML comment so a figure split across two `#` lines
  // still reads as one phrase (the `_204` parity idiom).
  const flattened = configText.split('\n')
    .filter((line) => line.trim().startsWith('#'))
    .map((line) => line.trim().replace(/^#\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
  for (const { label, pattern, bpm, errorPct } of PUBLISHED_MIN_BPM_AB) {
    const match = flattened.match(pattern);
    assert.ok(
      match,
      `${CONFIG_PATH} no longer publishes the "${label}" minBpm A/B figure. `
      + 'Re-run `node tools/bpm_tune_eval.mjs --opts \'{"minBpm":60}\'` (TRACKED config, '
      + 'no --effective) and restore it, or update PUBLISHED_MIN_BPM_AB here with the '
      + 'new measurement.',
    );
    assert.deepEqual(
      [match[1], match[2]], [bpm, errorPct],
      `${CONFIG_PATH} publishes "${label} → ${match[1]} (${match[2]}%)" but the measured `
      + `A/B is ${bpm} (${errorPct}%). One of the two is stale — re-run `
      + '`node tools/bpm_tune_eval.mjs --opts \'{"minBpm":60}\'` on the tracked config.',
    );
  }
  assert.match(
    flattened, /Re-run the A\/B before widening this again/,
    `${CONFIG_PATH} must keep the "re-run the A/B" instruction next to the published figures`,
  );
  // …and it must keep saying WHAT the figures were measured against. Without
  // this line the next re-run is as likely to be an `--effective` one, and an
  // `--effective` re-run erases the moderate 174 failure entirely.
  assert.match(
    flattened, /Measured on the TRACKED config in this file/,
    `${CONFIG_PATH} must keep the measurement-scoping line next to the published figures`,
  );
});
