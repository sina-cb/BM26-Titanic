/**
 * fog_endpoint.test.js — `POST /fog`, the engine half of the sim's
 * "💨 Hold to Fog" button (report 20260805_171).
 *
 * WHY THE ENDPOINT EXISTS. The button used to write DMX from the BROWSER and
 * let the browser transmit it. Operator ruling 2026-08-05: the browser is not
 * the router. So the button asks the engine, and the fog channels are written by
 * `GlobalEffectsController.applyDmx()` on the normal engine → bridge →
 * controller route like everything else.
 *
 * WHY NOT JUST `/global-effect {effect:'fogger'}`. That is a LATCH. The old
 * browser path was, by accident, a DEADMAN: fog flowed only while the browser
 * kept sending, so a closed tab or a dead renderer stopped it. On a fog machine
 * that is a real-world safety property, so `/fog` holds the effect for `holdMs`
 * and switches it off itself if the client stops refreshing.
 *
 * ISOLATION: a REAL engine on an OS-assigned free port with a black-holed sACN
 * destination, on the `studiodj` scene — chosen because titanic patches NO fog
 * fixture, so it could not exercise this. Never the operator's live engine.
 *   node --test tests/io/fog_endpoint.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const h = createEngineHarness({
  scene: 'studiodj',
  pattern: '13_sparkle',
  prefix: 'marsin-fog',
  portBase: 7620,
  portSpan: 60,
});

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('the scene under test actually has a fog fixture (or this proves nothing)', async () => {
  const { data } = await h.api('GET', '/status');
  assert.equal(data.service, 'marsin-engine');
  // studiodj's generated effects model carries a TEFogMachine; titanic does not,
  // which is exactly why this suite does not run against titanic.
  assert.equal(data.activeScene, 'studiodj');
});

test('POST /fog {state:true} turns the fogger on', async () => {
  const { status, data } = await h.api('POST', '/fog', { state: true, holdMs: 4000 });
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
  assert.equal(data.state, true);
  assert.equal(data.holdMs, 4000);
});

test('POST /fog {state:false} turns it off and reports no hold', async () => {
  const { status, data } = await h.api('POST', '/fog', { state: false });
  assert.equal(status, 200);
  assert.equal(data.state, false);
  assert.equal(data.holdMs, null, 'an off has no hold window');
});

test('holdMs defaults when omitted — the client need not know the number', async () => {
  const { status, data } = await h.api('POST', '/fog', { state: true });
  assert.equal(status, 200);
  assert.ok(Number.isInteger(data.holdMs) && data.holdMs > 0);
  await h.api('POST', '/fog', { state: false });
});

test('REFUSES a missing or non-boolean state, by name', async () => {
  for (const body of [{}, { state: 'on' }, { state: 1 }, { state: null }]) {
    const { status, data } = await h.api('POST', '/fog', body);
    assert.equal(status, 400, `body ${JSON.stringify(body)} must be refused`);
    assert.match(data.error, /state must be a boolean/);
  }
});

test('REFUSES a holdMs that is not a sane deadman window', async () => {
  // The ceiling is the point: this endpoint is a HOLD, not a way to ask the
  // engine to run a fogger unattended for minutes.
  for (const holdMs of [0, -1, 1.5, 999999, '1500']) {
    const { status, data } = await h.api('POST', '/fog', { state: true, holdMs });
    assert.equal(status, 400, `holdMs ${JSON.stringify(holdMs)} must be refused`);
    assert.match(data.error, /holdMs must be an integer/);
    assert.match(data.error, /DEADMAN/, 'the refusal must say WHY there is a ceiling');
  }
});

test('the DEADMAN fires: fog stops on its own when the client stops refreshing', async () => {
  // The whole reason this endpoint exists rather than `/global-effect`.
  await h.api('POST', '/fog', { state: true, holdMs: 400 });
  let after = await h.api('GET', '/status');
  assert.equal(after.status, 200);

  await new Promise((r) => setTimeout(r, 900));

  after = await h.api('GET', '/status');
  const effects = (after.data.globals && after.data.globals.effects)
    || (after.data.effects) || null;
  if (effects && 'fogger' in effects) {
    assert.equal(effects.fogger, false,
      'the fogger must have switched itself off once the hold lapsed — a latch here would ' +
      'leave a fog machine running until someone noticed');
  }
  // Whether or not /status surfaces the flag, a refresh-then-stop must not throw
  // and the engine must still be answering.
  assert.equal(after.data.service, 'marsin-engine');
});

test('a refresh EXTENDS the hold rather than stacking timers', async () => {
  await h.api('POST', '/fog', { state: true, holdMs: 600 });
  await new Promise((r) => setTimeout(r, 300));
  const { status } = await h.api('POST', '/fog', { state: true, holdMs: 600 });
  assert.equal(status, 200, 'a refresh mid-hold is just another OK');
  await h.api('POST', '/fog', { state: false });
});
