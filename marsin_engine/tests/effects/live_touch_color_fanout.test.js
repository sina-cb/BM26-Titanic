// docs/70 §4.2 W3 — the deck colour daemon (ColorAutopilot, single instance,
// api_server.js writeColorPaletteParams) fans its output out to an ARMED Live
// Touch session's PRIVATE ParamCenter, in addition to its existing write to
// the SHARED one.
//
// Recon-verified problem: ARM source-locks the shared CPC to 'api' for the
// whole armed session, so every 'colorAutopilot'-sourced write is silently
// swallowed by the shared centre (status:'ignored', reason:'source_lock')
// while the daemon keeps broadcasting — an armed Live session never sees the
// deck's colour. Live renders from `liveTouchSession.paramCenter`, a SEPARATE
// ParamCenter instance with no source lock of its own.
//
// What this proves:
//   1. With Live ARMED, a daemon-sourced palette write IS visible in
//      liveTouchSession.paramCenter (the bench-confirmation docs/70 §4.2
//      explicitly asks for).
//   2. With Live ARMED, the SHARED CPC still REFUSES the 'colorAutopilot'
//      write — the source lock is untouched, not weakened.
//   3. With NO session active, behaviour is byte-identical to before
//      (regression guard on the pre-existing shared-CPC write).
//   4. Arm -> disarm -> re-arm still fans out correctly — proves the fan-out
//      reads `liveTouchSession.paramCenter` fresh every call rather than
//      caching a reference that goes stale across the rebuild.
//
// Spawns ONE real engine on a random HIGH port with MARSIN_STATE_DIR /
// MARSIN_PLAYLISTS_DIR redirected into throwaway temp dirs and its sACN
// output black-holed on TEST-NET-1 (192.0.2.9, RFC 5737) — see
// .agent/memory/spawning_a_test_engine.md. Never touches
// simulation/scenes/** or marsin_engine/states/titanic/.
//
// Run: node --import ./tests/helpers/setup_config_guard.mjs --test tests/effects/live_touch_color_fanout.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { WebSocket } from 'ws';

import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'test_bench';
const OWNER = 'live_touch_color_fanout_owner';
const OWNER_HEADERS = { 'X-Touch-Control-Owner': OWNER };

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'live-touch-color-fanout',
  portBase: 17700,
  portSpan: 50,
  // Black-hole the spawned engine's sACN output on a TEST-NET-1 (RFC 5737)
  // address. A LOOPBACK destination is NOT isolation — the sim's sACN
  // receiver binds every interface and would relay loopback-destined frames
  // on to the operator's live rig.
  extraArgs: ['--dest', '192.0.2.9'],
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForMessage(messages, predicate, timeoutMs = 4000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(10);
  }
  assert.fail(`timed out waiting for a WS message; received ${JSON.stringify(messages)}`);
}

async function openControl() {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const messages = [];
  ws.on('message', raw => {
    try { messages.push(JSON.parse(raw)); } catch { /* unrelated binary telemetry */ }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER }));
  await waitForMessage(messages, m => m.type === 'touchControlHelloAck');
  return { ws, messages };
}

async function setArmed(control, armed) {
  const priorCount = control.messages.length;
  control.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER, armed }));
  const ack = await waitForMessage(
    control.messages,
    (message, index) => index >= priorCount
      && message.type === 'touchControlArmedAck'
      && message.requestedArmed === armed,
  );
  assert.equal(ack.armed, armed, `ARM request armed=${armed} was not acknowledged: ${JSON.stringify(ack)}`);
  return ack;
}

function closeControl(control) {
  return new Promise(resolve => {
    if (control.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    control.ws.once('close', resolve);
    control.ws.close();
  });
}

/**
 * Hard-cut the deck colour daemon onto ONE inline {c1,c2} pair right now.
 * While Live Touch is ARMED, every mutating HTTP request (this REST route
 * included) requires the armed owner's header, so `armed` picks the header
 * set — the daemon itself is a global, unscoped surface either way (docs/70
 * §4.1: "Unauthenticated, unscoped: Live Touch may legally drive it today").
 */
async function postHardCutPalette(pair, armed = false) {
  const post = await h.api('POST', '/deck/color-autopilot', {
    active: true, shuffle: false, delay_s: 0.3, transitionMs: 0, palettes: [pair],
  }, armed ? OWNER_HEADERS : {});
  assert.equal(post.status, 200, JSON.stringify(post.data));
}

async function parkDaemon(armed = false) {
  await h.api('POST', '/deck/color-autopilot', { active: false }, armed ? OWNER_HEADERS : {});
}

async function sharedPalette() {
  const pc = await h.api('GET', '/param-center');
  assert.equal(pc.status, 200);
  return { c1: pc.data.params.colorPalette1.value, c2: pc.data.params.colorPalette2.value };
}

async function livePalette() {
  const pc = await h.api('GET', '/param-center', undefined, OWNER_HEADERS);
  assert.equal(pc.status, 200, JSON.stringify(pc.data));
  return { c1: pc.data.params.colorPalette1.value, c2: pc.data.params.colorPalette2.value };
}

function huesMatch(got, pair) {
  return Math.abs(got.c1.h - pair.c1) < 1e-6 && Math.abs(got.c2.h - pair.c2) < 1e-6;
}

/** Poll a palette-reading fn until its hues match `pair`, or fail at timeoutMs. */
async function waitForPaletteMatch(readFn, pair, label, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readFn();
    if (huesMatch(last, pair)) return last;
    await sleep(100);
  }
  assert.fail(`${label} never took hues c1=${pair.c1} c2=${pair.c2}; last saw ${JSON.stringify(last)}`);
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await parkDaemon();
  await h.teardown();
});

test('no session active: shared CPC takes the daemon write, byte-identical to before (regression guard)', async () => {
  const pair = { c1: 0.11, c2: 0.53 };
  const before = await sharedPalette();
  assert.ok(!huesMatch(before, pair), 'baseline must not already be at the target pair');

  await postHardCutPalette(pair);
  const after = await waitForPaletteMatch(sharedPalette, pair, 'shared CPC (no session)');
  assert.equal(after.c1.s, 1);
  assert.equal(after.c1.v, 1);
  await parkDaemon();
});

test('Live ARMED: the daemon write reaches the private session centre, and the shared CPC still refuses it (source lock intact)', async () => {
  const control = await openControl();
  await setArmed(control, true);

  try {
    const baseline = await sharedPalette();
    const pair = { c1: 0.22, c2: 0.64 };
    assert.ok(!huesMatch(baseline, pair), 'baseline must not already be at the target pair');

    await postHardCutPalette(pair, true);

    // 1. The bench-confirmation docs/70 §4.2 asks for: the private centre
    // sees the daemon's palette while armed.
    await waitForPaletteMatch(livePalette, pair, "Live's private ParamCenter (ARMED)");

    // 2. The shared CPC's source lock is untouched: it must NOT have taken
    // the 'colorAutopilot' write while a Live session holds the 'api' lock.
    // Give the daemon a further beat (it is actively cycling) so a bug that
    // let the shared write through has time to show up.
    await sleep(500);
    const sharedAfter = await sharedPalette();
    assert.deepEqual(sharedAfter, baseline,
      'shared CPC must still be source-locked against colorAutopilot writes while Live is ARMED');

    await parkDaemon(true);
  } finally {
    await setArmed(control, false);
    await closeControl(control);
  }
});

test('arm -> disarm -> re-arm: fan-out still works after the private ParamCenter is rebuilt (no stale reference)', async () => {
  const control = await openControl();

  await setArmed(control, true);
  const pairA = { c1: 0.05, c2: 0.41 };
  await postHardCutPalette(pairA, true);
  await waitForPaletteMatch(livePalette, pairA, "Live's private ParamCenter (first ARM)");
  await parkDaemon(true);
  await setArmed(control, false);

  // Disarming rebuilds liveTouchSession.paramCenter
  // (_replaceTransientState). A fan-out that had cached the old instance
  // would now be writing into a dead, unrendered object.
  await setArmed(control, true);
  const pairB = { c1: 0.77, c2: 0.18 };
  await postHardCutPalette(pairB, true);
  await waitForPaletteMatch(livePalette, pairB, "Live's private ParamCenter (re-ARM)");

  await parkDaemon(true);
  await setArmed(control, false);
  await closeControl(control);
});
