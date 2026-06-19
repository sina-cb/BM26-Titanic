import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultTimelineConfig, validateTimelineConfig, loadTimelineConfig,
  saveTimelineConfig, dumpTimelineConfig,
} from '../companions/timeline/timeline_config.js';

test('defaultTimelineConfig validates', () => {
  const cfg = validateTimelineConfig(defaultTimelineConfig());
  assert.equal(cfg.port, 6965);
  assert.equal(cfg.engine.port, 6968);
  assert.equal(cfg.mood.key, 'audioParty');
  assert.equal(cfg.tickMs, 1000);
});

test('loadTimelineConfig returns default on ENOENT', () => {
  const missing = path.join(os.tmpdir(), 'definitely-missing-timeline-cfg-xyz.yaml');
  const cfg = loadTimelineConfig(missing);
  assert.equal(cfg.port, 6965);
});

test('validate throws on bad port', () => {
  assert.throws(() => validateTimelineConfig({ port: 99999 }), /port/);
  assert.throws(() => validateTimelineConfig({ port: 'nope' }), /port/);
  assert.throws(() => validateTimelineConfig({ engine: { port: 0 } }), /engine.port/);
});

test('validate throws on bad mood source', () => {
  assert.throws(() => validateTimelineConfig({ mood: { source: 'mars' } }), /mood.source/);
});

test('round-trips through dump -> load via a tmp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlcfg-'));
  const file = path.join(dir, 'timeline_config.yaml');
  const saved = saveTimelineConfig(defaultTimelineConfig(), file);
  const loaded = loadTimelineConfig(file);
  assert.deepEqual(loaded, saved);
  assert.equal(dumpTimelineConfig(loaded), dumpTimelineConfig(saved));
});
