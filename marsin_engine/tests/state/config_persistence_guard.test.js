// Proves the config-persistence guard: autopilot saves must land on the
// MARSIN_CONFIG_FILE scratch path (set by setup_config_guard.mjs, loaded via
// `node --import`), NEVER on the tracked, comment-bearing config.yaml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realConfig = path.join(here, '..', '..', 'config.yaml');

test('guard sets MARSIN_CONFIG_FILE to a scratch path, not config.yaml', () => {
  assert.ok(process.env.MARSIN_CONFIG_FILE, 'setup_config_guard.mjs must set MARSIN_CONFIG_FILE');
  assert.notEqual(
    path.resolve(process.env.MARSIN_CONFIG_FILE),
    path.resolve(realConfig),
    'the scratch path must differ from the tracked config.yaml',
  );
});

test('ColorAutopilot with the production (undefined) path writes to the scratch copy, not config.yaml', async () => {
  const before = fs.readFileSync(realConfig);
  const { ColorAutopilot } = await import('../../lib/color_autopilot.js');
  // `undefined` configFile mirrors the production wiring at api_server.js:3420.
  const ca = new ColorAutopilot(() => {}, undefined);
  assert.equal(
    path.resolve(ca.configFile),
    path.resolve(process.env.MARSIN_CONFIG_FILE),
    'undefined configFile must resolve to the guarded scratch path',
  );
  ca.setState({ active: false, palettes: ['aurora'], delay_s: 2, shuffle: false }); // triggers saveConfig
  const after = fs.readFileSync(realConfig);
  assert.deepEqual(after, before, 'tracked config.yaml must be byte-identical after an autopilot save');
});

test('deck Autopilot persists to the scratch copy, not config.yaml', async () => {
  const before = fs.readFileSync(realConfig);
  const mod = await import('../../lib/autopilot.js');
  const Autopilot = mod.Autopilot || mod.default;
  assert.ok(typeof Autopilot === 'function', 'autopilot.js must export an Autopilot class');
  // constructor(listPatternsFn, patternsDir, currentPatternCb, changePatternFn, onScheduleFn)
  const ap = new Autopilot(() => [], here, () => null, () => {}, () => {});
  ap.updateState({ active: false, delay_s: '30', shuffle: false }); // triggers saveConfig
  const after = fs.readFileSync(realConfig);
  assert.deepEqual(after, before, 'tracked config.yaml must be byte-identical after a deck-autopilot save');
});
