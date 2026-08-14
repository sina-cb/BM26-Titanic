import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import yaml from 'js-yaml';

import { writeBlackHoledConfig } from '../e2e/timeline_e2e_harness.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-latency-config-'));
const configPath = writeBlackHoledConfig(configDir, { enabled: false });
const isolatedConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
isolatedConfig.fire_sync = { ...(isolatedConfig.fire_sync || {}), enabled: false };
fs.writeFileSync(configPath, yaml.dump(isolatedConfig), 'utf8');
const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'layer-transition-latency',
  portBase: 31568,
  portSpan: 1,
  extraEnv: {
    MARSIN_CONFIG_FILE: configPath,
    MARSIN_VSN1_DEPLOY: '0',
  },
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForLanding(target, startedAt, timeoutMs = 500) {
  let last = null;
  while (performance.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/layers/state');
    assert.equal(response.status, 200);
    last = response.data;
    if (last.active === target && last.transition === null) {
      return performance.now() - startedAt;
    }
    await sleep(5);
  }
  assert.fail(`layer ${target} did not land; last=${JSON.stringify(last)}`);
}

function percentile(samples, percentileValue) {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(percentileValue * ordered.length) - 1)];
}

test('Deck and Mixer land in the 100 ms frame window and reject empty Mixer', async () => {
  try {
    h.spawnEngine();
    await h.waitForReady();

    const initial = await h.api('GET', '/layers/state');
    assert.equal(initial.data.active, 'deck', 'empty Mixer startup must remain safely on Deck');

    let startedAt = performance.now();
    let response = await h.api('POST', '/layers/activate', { target: 'mixer' });
    const rejectedAckMs = performance.now() - startedAt;
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'MIXER_NOT_READY');
    assert.ok(rejectedAckMs < 250, `empty-Mixer refusal took ${rejectedAckMs.toFixed(1)} ms`);
    const unchanged = await h.api('GET', '/layers/state');
    assert.equal(unchanged.data.active, 'deck');
    assert.equal(unchanged.data.transition, null, 'failed preflight must not mutate the router');

    response = await h.api('POST', '/mixer/view', { view: 'mixer' });
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'MIXER_NOT_READY');

    response = await h.api('POST', '/mixer/channels', {
      pattern: '13_sparkle',
      name: 'Latency contributor',
      mode: 'blend_screen',
      fader: 1,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));

    const timings = [];
    const targets = Array.from({ length: 12 }, (_, index) => (
      index % 2 === 0 ? 'mixer' : 'deck'
    ));
    for (const target of targets) {
      startedAt = performance.now();
      response = await h.api('POST', '/layers/activate', {
        target,
        reason: 'latency_contract',
      });
      const ackMs = performance.now() - startedAt;
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.transition.durationMs, 100);
      assert.equal(response.data.transition.curve, 'linear');
      assert.ok(ackMs < 250, `${target} activation acknowledgement took ${ackMs.toFixed(1)} ms`);
      const landMs = await waitForLanding(target, startedAt);
      assert.ok(landMs >= 75, `${target} blend landed too early at ${landMs.toFixed(1)} ms`);
      assert.ok(landMs <= 350, `${target} blend landed too late at ${landMs.toFixed(1)} ms`);
      timings.push({ target, ackMs: Number(ackMs.toFixed(3)), landMs: Number(landMs.toFixed(3)) });
    }
    const summary = {};
    for (const target of ['mixer', 'deck']) {
      const directed = timings.filter(sample => sample.target === target);
      const acknowledgements = directed.map(sample => sample.ackMs);
      const landings = directed.map(sample => sample.landMs);
      summary[target] = {
        samples: directed.length,
        ackP50Ms: Number(percentile(acknowledgements, 0.50).toFixed(3)),
        ackP95Ms: Number(percentile(acknowledgements, 0.95).toFixed(3)),
        landP50Ms: Number(percentile(landings, 0.50).toFixed(3)),
        landP95Ms: Number(percentile(landings, 0.95).toFixed(3)),
      };
    }
    process.stdout.write(`layer_transition_latency=${JSON.stringify({ summary, timings })}\n`);
  } finally {
    await h.teardown();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
