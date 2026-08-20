// End-to-end: POST /mixer/channels must REFUSE an unknown blend mode.
//
// Why this exists (report `_254`). The mixer render hot path has no fallback
// compositor any more: a channel whose `mode` has no compiled WASM handle
// makes `renderAll6ch()` THROW, and because that runs inside the 40 Hz
// `tick()` interval with no surrounding try/catch, the engine's
// `uncaughtException` handler prints `⛔ ENGINE FATAL` and `process.exit(1)`.
// That throw is the CORRECT behaviour (codex P0: no fallback — a wrong look
// on the ship is worse than a loud stop), which makes the API boundary the
// only place an unknown mode may be caught.
//
// Every other mode-writing route already gated on `isValidBlendMode`
// (PATCH /mixer/channels/:id, WS setChannelMode, both deck-overlay paths).
// POST /mixer/channels — the ONE channel-CREATING route — passed `data.mode`
// straight through to `mixer.addMixerChannel`, so a single typo'd POST could
// take the rig down on the very next frame. This suite pins the gate shut.
//
// The spawned engine sits on a high port and black-holes its sACN to
// TEST-NET-1 (RFC 5737, never routed) so it can never reach the operator's
// live stack on :6966-:6972 / UDP 5568.
//
// Run:  cd marsin_engine && node --test tests/mixer/channel_create_mode_gate.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'summer_camp_dome';

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'marsin-modegate',
  portBase: 17400,
  portSpan: 40,
  // Black-hole sACN. A loopback dest is NOT a black hole (the sim's receiver
  // binds every local interface and would relay onward to the real rig).
  extraArgs: ['--dest', '192.0.2.9'],
});
const { api } = h;

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('POST /mixer/channels rejects a typo blend mode with 400', async () => {
  const r = await api('POST', '/mixer/channels', {
    pattern: '13_sparkle',
    mode: 'blend_scren',
  });
  assert.equal(r.status, 400, 'a mode with no script must never reach the mixer');
  assert.match(String(r.data && r.data.error), /Invalid blend mode 'blend_scren'/);
});

test('POST /mixer/channels rejects an uncataloged trans_* name', async () => {
  const r = await api('POST', '/mixer/channels', {
    pattern: '13_sparkle',
    mode: 'trans_morse_blink',
  });
  assert.equal(r.status, 400, 'only the executable transition catalog is accepted');
});

test('POST /mixer/channels rejects a non-string mode', async () => {
  const r = await api('POST', '/mixer/channels', { pattern: '13_sparkle', mode: 42 });
  assert.equal(r.status, 400);
});

// The POST response carries ids, not the full channel — read the mode back
// off /mixer so we assert what the MIXER actually holds, not what the route
// echoed.
async function channelMode(channelId) {
  const m = await api('GET', '/mixer');
  const chans = (m.data && m.data.channels) || [];
  const found = chans.find(c => c.id === channelId);
  return found ? found.mode : null;
}

test('POST /mixer/channels still accepts the valid steady blends', async () => {
  for (const mode of ['blend_screen', 'blend_add', 'blend_over']) {
    const r = await api('POST', '/mixer/channels', { pattern: '13_sparkle', mode });
    assert.equal(r.status, 200, `${mode} must still be accepted`);
    assert.equal(await channelMode(r.data.channelId), mode);
  }
});

test('omitting mode still defaults to blend_screen (gate is not a new requirement)', async () => {
  const r = await api('POST', '/mixer/channels', { pattern: '13_sparkle' });
  assert.equal(r.status, 200);
  assert.equal(await channelMode(r.data.channelId), 'blend_screen');
});

test('the engine survived every rejected mode (no fatal render throw)', async () => {
  const s = await api('GET', '/status');
  assert.equal(s.status, 200, 'engine still answering — a leaked bad mode would have killed it');
  assert.equal(s.data.renderHealth.ok, true, 'no blend errors recorded');
});
