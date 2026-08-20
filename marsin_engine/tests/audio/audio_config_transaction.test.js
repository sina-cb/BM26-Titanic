import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engineSource = fs.readFileSync(path.join(here, '..', '..', 'engine.js'), 'utf8');

function functionBody(startMarker, endMarker) {
  const start = engineSource.indexOf(startMarker);
  const end = engineSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected ${startMarker} before ${endMarker}`);
  return engineSource.slice(start, end);
}

test('applyLiveUpdate persists before touching analyzer/config/dirty runtime truth', () => {
  const body = functionBody(
    'audioState.applyLiveUpdate = async function applyLiveUpdate',
    'audioState.resetToDefaults = function resetToDefaults',
  );
  const persistAt = body.indexOf('persistSceneAudioState(next, nextDirtyGroups)');
  assert.ok(persistAt >= 0);
  for (const mutation of [
    'audioState.capture.stop()',
    'audioState.analyzer.reconfigure',
    'audioState.config = next',
    'audioState.derivedDirtyGroups = nextDirtyGroups',
  ]) {
    assert.ok(body.indexOf(mutation) > persistAt, `${mutation} must follow durable persistence`);
  }
});

test('reset persists stripped state before mutating analyzer/config/dirty truth', () => {
  const body = functionBody(
    'audioState.resetToDefaults = function resetToDefaults',
    '// Boot-write the per-scene audio_state.yaml',
  );
  const persistAt = body.indexOf('saveSceneAudio(audioState.sceneDir, stripped)');
  assert.ok(persistAt >= 0);
  for (const mutation of [
    'audioState.analyzer.reconfigure',
    'audioState.config = next',
    'audioState.derivedDirtyGroups = new Set()',
  ]) {
    assert.ok(body.indexOf(mutation) > persistAt, `${mutation} must follow durable persistence`);
  }
  assert.ok(body.includes("'derivedSignals'"), 'reset must remove persisted derived overrides');
  assert.ok(body.includes('const stripped = { ...onDisk }'), 'reset must preserve orthogonal state');
});

test('boot write failure is fatal instead of warning and continuing', () => {
  const boot = functionBody(
    '// Boot-write the per-scene audio_state.yaml',
    'await buildAndStartAudio()',
  );
  assert.match(boot, /fatal boot-write failure/);
  assert.match(boot, /process\.exit\(1\)/);
  assert.doesNotMatch(boot, /console\.warn/);
});
