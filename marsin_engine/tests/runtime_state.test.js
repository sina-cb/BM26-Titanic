/**
 * tests/runtime_state.test.js
 *
 * Unit coverage for the runtime/defaults state split (lib/runtime_state.js):
 * seeding (never overwrites live runtime), status/dirty rollup, promote
 * (runtime → defaults incl. deletion mirroring), and reset (defaults →
 * runtime). Operates on a disposable, clearly-namespaced model so it
 * never touches a real scene; both trees are removed in a finally.
 *
 * Run:  node --test tests/runtime_state.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
  stateDefaultsDir,
  runtimeStateDir,
  seedRuntimeState,
  runtimeStateStatus,
  promoteRuntimeState,
  resetRuntimeState,
} from '../lib/runtime_state.js';

const MODEL = '__rs_unit_test__';
const DEFAULTS = stateDefaultsDir(MODEL);
const RUNTIME = runtimeStateDir(MODEL);

function reset() {
  fs.rmSync(DEFAULTS, { recursive: true, force: true });
  fs.rmSync(RUNTIME, { recursive: true, force: true });
}

function writeYaml(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function readYaml(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function seedFixtureDefaults() {
  writeYaml(DEFAULTS, 'mixer_state.yaml', 'master: 1.0\n');
  writeYaml(DEFAULTS, 'globals_state.yaml', 'blackout: false\n');
  writeYaml(DEFAULTS, 'playlists/default.yaml', 'name: default\nentries: []\n');
}

test('seedRuntimeState copies missing files, recurses into playlists/', () => {
  reset();
  try {
    seedFixtureDefaults();
    const seeded = seedRuntimeState(MODEL).sort();
    assert.deepEqual(seeded, ['globals_state.yaml', 'mixer_state.yaml', 'playlists/default.yaml']);
    assert.equal(readYaml(RUNTIME, 'mixer_state.yaml'), 'master: 1.0\n');
    assert.equal(readYaml(RUNTIME, 'playlists/default.yaml'), 'name: default\nentries: []\n');
  } finally {
    reset();
  }
});

test('seedRuntimeState never overwrites existing runtime files (cache survives)', () => {
  reset();
  try {
    seedFixtureDefaults();
    seedRuntimeState(MODEL);
    // Simulate a live edit landing in the runtime cache.
    writeYaml(RUNTIME, 'mixer_state.yaml', 'master: 0.42\n');
    // A later default added upstream still seeds in, untouched runtime stays.
    writeYaml(DEFAULTS, 'audio_state.yaml', 'enabled: true\n');
    const seeded = seedRuntimeState(MODEL);
    assert.deepEqual(seeded, ['audio_state.yaml'], 'only the new default seeds');
    assert.equal(readYaml(RUNTIME, 'mixer_state.yaml'), 'master: 0.42\n', 'live edit preserved');
  } finally {
    reset();
  }
});

test('runtimeStateStatus reports per-file drift and a dirty rollup', () => {
  reset();
  try {
    seedFixtureDefaults();
    seedRuntimeState(MODEL);
    let st = runtimeStateStatus(MODEL);
    assert.equal(st.dirty, false, 'fresh seed matches defaults');

    writeYaml(RUNTIME, 'globals_state.yaml', 'blackout: true\n');   // differs
    writeYaml(RUNTIME, 'playlists/show.yaml', 'name: show\n');      // runtime-only
    st = runtimeStateStatus(MODEL);
    assert.equal(st.dirty, true);
    const byName = Object.fromEntries(st.files.map(f => [f.file, f]));
    assert.equal(byName['globals_state.yaml'].differs, true);
    assert.equal(byName['playlists/show.yaml'].inDefaults, false);
    assert.equal(byName['playlists/show.yaml'].inRuntime, true);
  } finally {
    reset();
  }
});

test('promoteRuntimeState mirrors runtime onto defaults including deletions', () => {
  reset();
  try {
    seedFixtureDefaults();
    seedRuntimeState(MODEL);
    // Edit one, add a playlist, delete the default playlist in the runtime.
    writeYaml(RUNTIME, 'globals_state.yaml', 'blackout: true\n');
    writeYaml(RUNTIME, 'playlists/show.yaml', 'name: show\n');
    fs.unlinkSync(path.join(RUNTIME, 'playlists/default.yaml'));

    const result = promoteRuntimeState(MODEL);
    assert.ok(result.written.includes('globals_state.yaml'));
    assert.ok(result.written.includes('playlists/show.yaml'));
    assert.ok(result.removed.includes('playlists/default.yaml'),
      'deleted runtime playlist must be removed from defaults, not resurrected');

    // Defaults now match runtime exactly.
    assert.equal(readYaml(DEFAULTS, 'globals_state.yaml'), 'blackout: true\n');
    assert.equal(fs.existsSync(path.join(DEFAULTS, 'playlists/show.yaml')), true);
    assert.equal(fs.existsSync(path.join(DEFAULTS, 'playlists/default.yaml')), false);
    assert.equal(runtimeStateStatus(MODEL).dirty, false);
  } finally {
    reset();
  }
});

test('promoteRuntimeState throws when there is no runtime to promote (fail loud)', () => {
  reset();
  try {
    seedFixtureDefaults(); // defaults only, no runtime dir
    assert.throws(() => promoteRuntimeState(MODEL), /No runtime state to promote/);
  } finally {
    reset();
  }
});

test('resetRuntimeState mirrors defaults back over the runtime', () => {
  reset();
  try {
    seedFixtureDefaults();
    seedRuntimeState(MODEL);
    // Diverge the runtime, then reset it.
    writeYaml(RUNTIME, 'globals_state.yaml', 'blackout: true\n');
    writeYaml(RUNTIME, 'playlists/scratch.yaml', 'name: scratch\n');

    const result = resetRuntimeState(MODEL);
    assert.ok(result.written.includes('globals_state.yaml'));
    assert.ok(result.removed.includes('playlists/scratch.yaml'),
      'runtime-only file removed on reset');
    assert.equal(readYaml(RUNTIME, 'globals_state.yaml'), 'blackout: false\n');
    assert.equal(runtimeStateStatus(MODEL).dirty, false);
  } finally {
    reset();
  }
});

test('atomic writes leave no .tmp- residue after promote', () => {
  reset();
  try {
    seedFixtureDefaults();
    seedRuntimeState(MODEL);
    writeYaml(RUNTIME, 'globals_state.yaml', 'blackout: true\n');
    promoteRuntimeState(MODEL);
    const stray = fs.readdirSync(DEFAULTS).filter(f => f.includes('.tmp-'));
    assert.deepEqual(stray, [], 'no temp files left in defaults');
  } finally {
    reset();
  }
});
