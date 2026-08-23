import fs from 'fs';
import os from 'os';
import path from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deck OFF vetoes timers, countdowns, and event-driven advances', async (t) => {
  const root = fs.mkdtempSync(path.join(os.homedir(), 'tmp', 'autopilot_authority.'));
  const configPath = path.join(root, 'config.yaml');
  fs.writeFileSync(configPath, 'playlist:\n  active: true\n  delay_s: 60\n  shuffle: false\n');

  const priorConfig = process.env.MARSIN_CONFIG_FILE;
  process.env.MARSIN_CONFIG_FILE = configPath;
  t.after(() => {
    if (priorConfig === undefined) delete process.env.MARSIN_CONFIG_FILE;
    else process.env.MARSIN_CONFIG_FILE = priorConfig;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { Autopilot } = await import(`../../lib/autopilot.js?authority=${Date.now()}`);
  let deckActive = false;
  let advances = 0;
  const daemon = new Autopilot(
    () => [],
    root,
    () => null,
    () => { advances += 1; },
    null,
    () => deckActive,
  );

  daemon.start();
  assert.equal(daemon.cycleTimer, null, 'deck OFF must arm no timer');
  assert.equal(daemon.nextSwapAtMs, null, 'deck OFF must expose no countdown');

  await daemon.requestAdvance();
  assert.equal(advances, 0, 'deck OFF must veto profile-triggered advances');

  deckActive = true;
  daemon.updateState({ active: true, delay_s: 60 });
  assert.notEqual(daemon.cycleTimer, null, 'deck ON may arm the timer');
  assert.equal(typeof daemon.nextSwapAtMs, 'number');

  deckActive = false;
  assert.equal(daemon.nextSwapAtMs, null, 'deck OFF immediately hides a previously armed deadline');
  await daemon.triggerNext();
  assert.equal(advances, 0, 'deck OFF vetoes even a direct stale trigger');

  daemon.updateState({ active: false });
  assert.equal(daemon.cycleTimer, null);
});
