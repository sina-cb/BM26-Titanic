// endpoint_validation — Wave 3 of the touch-panel audit fixes
// (.agent/reports/202608/20260810_2_touch_panel_audit.md H10/H16/H18/mediums).
//
// One spawned engine, black-box over HTTP. Every test is a pair: the bad input
// is REFUSED with a 400 that names the problem (codex P0 — throw, never
// coerce), and the good input still works. Plus the two constant-black holes:
// strobe intensity 0 and an all-black movement palette.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'endpoint-validation',
  portBase: 7900,
  portSpan: 200,
  extraEnv: { MARSIN_VSN1_DEPLOY: '0' },
  // TEST-NET-1 (RFC 5737) black hole — loopback is not one.
  extraArgs: ['--dest', '192.0.2.9'],
});

before(async () => { h.spawnEngine(); await h.waitForReady(); });
after(async () => { await h.teardown(); });

test('source-lock: malformed bodies are refused, sane ones apply (H16)', async () => {
  for (const bad of [
    null, [], 'open',
    {},                                        // no mode
    { mode: 'banana' },
    { mode: 'global' },                        // no source
    { mode: 'global', source: '' },
    { mode: 'per-param' },                     // no leases
    { mode: 'per-param', leases: {} },
    { mode: 'per-param', leases: { speed: 42 } },
    { mode: 'per-param', leases: { speed: '' } },
  ]) {
    const { status } = await h.api('POST', '/param-center/source-lock', bad);
    assert.equal(status, 400, `must refuse ${JSON.stringify(bad)}`);
  }
  let r = await h.api('POST', '/param-center/source-lock',
    { mode: 'per-param', leases: { speed: 'api' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.sourceLock.mode, 'per-param');
  r = await h.api('POST', '/param-center/source-lock', { mode: 'open' });
  assert.equal(r.status, 200);
  assert.equal(r.data.sourceLock, null);
});

test('param-center reports ignored writes instead of a bare ok', async () => {
  // Lock speed to 'osc', then write it as 'api' over HTTP: the write is
  // ignored and the response must SAY so (it used to return {status:"ok"}).
  await h.api('POST', '/param-center/source-lock',
    { mode: 'per-param', leases: { speed: 'osc' } });
  const { status, data } = await h.api('POST', '/param-center', { speed: 0.9 });
  assert.equal(status, 200);
  assert.equal(data.status, 'partial', `got ${JSON.stringify(data)}`);
  assert.equal(data.ignored.length, 1);
  assert.equal(data.ignored[0].key, 'speed');
  await h.api('POST', '/param-center/source-lock', { mode: 'open' });
});

test('strobe-rate: intensity 0 is refused — it is a constant blackout (H10)', async () => {
  const { status } = await h.api('POST', '/strobe-rate',
    { active: true, hz: 4, duty: 0.5, intensity: 0 });
  assert.equal(status, 400,
    'gate maths scales OFF frames by 0 and ON frames by intensity — 0 blacks every frame');
  const ok = await h.api('POST', '/strobe-rate', { active: true, hz: 4, duty: 0.5, intensity: 1 });
  assert.equal(ok.status, 200);
  await h.api('POST', '/strobe-rate', { active: false });
});

test('movement-rate: bad and all-black palettes are refused (H10)', async () => {
  const base = { active: true, mode: 'whole_group', pixelsPerSecond: 5, amount: 1 };
  for (const colors of [
    'red', [], [['red', 0, 0, 0, 0, 0]], [[0.5, 0.5]], [[0.5, 0.5, 0.5, 0, 0, NaN]],
    [[0, 0, 0, 0, 0, 0], [0.01, 0, 0, 0, 0, 0]],   // all-black (peak 0.01 < 0.05)
  ]) {
    const { status } = await h.api('POST', '/movement-rate', { ...base, colors });
    assert.equal(status, 400, `must refuse colors=${JSON.stringify(colors)}`);
  }
  const ok = await h.api('POST', '/movement-rate',
    { ...base, colors: [[1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]] });
  assert.equal(ok.status, 200);
  await h.api('POST', '/movement-rate', { active: false });
});

test('section-brightness: non-numeric brightness is refused, not persisted (medium)', async () => {
  const groups = await h.api('GET', '/dimmer-groups');
  const ids = Object.values(groups.data);
  assert.ok(ids.length > 0, 'model must expose dimmer groups');
  for (const bad of ['1', null, NaN, -0.1, 1.1, {}]) {
    const { status } = await h.api('POST', '/section-brightness',
      { sectionId: ids[0], brightness: bad });
    assert.equal(status, 400, `must refuse brightness=${JSON.stringify(bad)}`);
  }
  const ok = await h.api('POST', '/section-brightness', { sectionId: ids[0], brightness: 0.5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('autopilot: coercible garbage is refused, PATCH semantics kept (medium)', async () => {
  for (const bad of [
    { active: 'true' },
    { delay_s: 'abc' },
    { delay_s: 0 },            // parseInt(...) || 30 used to turn this into 30
    { delay_s: -5 },
    { shuffle: 1 },
    { groupSize: 2.5 },
    { groupDwell: 'fast' },
  ]) {
    const { status } = await h.api('POST', '/autopilot', bad);
    assert.equal(status, 400, `must refuse ${JSON.stringify(bad)}`);
  }
  // A clean partial patch still lands and echoes state.
  const r = await h.api('POST', '/autopilot', { delay_s: 45 });
  assert.equal(r.status, 200);
  assert.equal(r.data.delay_s, 45);
  // The deployed CaptainPad sends delay_s as a NUMERIC STRING - that exact
  // wire format must keep working (compatibility allowance, not a fallback).
  const rs = await h.api('POST', '/autopilot', { delay_s: '50' });
  assert.equal(rs.status, 200, JSON.stringify(rs.data));
  assert.equal(rs.data.delay_s, 50);
  const rb = await h.api('POST', '/autopilot', { delay_s: '0' });
  assert.equal(rb.status, 400, "'0' must still be refused - parseInt||30 used to make it 30");
  assert.equal(r.status, 200);
  assert.equal(r.data.delay_s, 45);
  // Leave the harness engine as it was (autopilot state is engine-local).
  await h.api('POST', '/autopilot', { delay_s: 30 });
});

test('a handler throw after headers cannot crash the response path (H18b)', async () => {
  // /spatial-paint throws on a bad mode BEFORE writing headers -> clean 400
  // via the new split catch (was: catch conflated with Invalid JSON).
  const { status, data } = await h.api('POST', '/spatial-paint', { mode: 'nope' });
  assert.equal(status, 400);
  assert.match(String(data.error || ''), /mode/);
});
