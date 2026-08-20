/**
 * ws_connect_replay.test.js — the connect-replay SET, pinned against the
 * router and against what CaptainPad actually parses (catalog
 * `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md` G-9).
 *
 * The four `/ws/*` topics replay cached payloads on connect
 * (`lib/api_server.js:10143-10627`). `ws_topic_routing.test.js` pins
 * type->topic mapping (unit, no socket); `ws_frame_crashproof.test.js`
 * proves the replay mechanism EXISTS after abuse. Nobody pinned the
 * replayed SET itself, or checked it against CaptainPad's consumer.
 *
 * IMPORTANT CORRECTION vs the catalog's spec text: the router
 * (`lib/ws_topic_routing.js`) tells you which SOCKET a `type` would ride if
 * broadcast — it does NOT tell you which of those types are replayed ON
 * CONNECT (that is the engine's own choice per socket, hand-coded at each
 * `wss*.on('connection', ...)`). In particular, `/ws/params` replays ONLY
 * `sharedParams` on connect (api_server.js:10596-10607) — `paramSchema` is
 * broadcast on registry CHANGE, never replayed at connect. Asserting the
 * catalog's literal "{sharedParams, paramSchema}" would pin a payload the
 * code never sends; this file pins the REAL set instead, derived from a live
 * connection, and separately proves the router-derived MEMBERSHIP claim
 * (a replayed type really does belong to the socket it arrived on).
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';
import { topicForType, TOPICS } from '../../lib/ws_topic_routing.js';

const harness = createEngineHarness({
  scene: 'test_bench',
  prefix: 'wsreplay',
  // TEST-NET-1 (RFC 5737) black hole — loopback is not one.
  extraArgs: ['--dest', '192.0.2.9'],
});

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
});

after(async () => {
  await harness.teardown();
});

/** Connect to a WS path, collect every replayed `type` for `windowMs`, then close. */
function collectReplayTypes(wsPath, windowMs = 1500) {
  return new Promise((resolve, reject) => {
    const url = harness.base().replace('http://', 'ws://') + wsPath;
    const ws = new WebSocket(url);
    const messages = [];
    const timer = setTimeout(() => { ws.close(); resolve(messages); }, windowMs);
    ws.on('message', (buf) => {
      let parsed;
      try {
        parsed = JSON.parse(buf.toString());
      } catch (e) {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`non-JSON WS frame: ${buf.toString()}`));
        return;
      }
      messages.push(parsed);
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// CaptainPad's engine-facing parser: hooks/useEngineState.ts:472-580 switches
// on EXACTLY these seven `msg.type` values (grep-verified at test-write
// time — the file has no other `msg.type ===` branch). Any OTHER type
// replayed on /ws/control or /ws/params is consumed by something else in
// CaptainPad (a different hook/component) or is engine-internal-only; either
// way it belongs in ENGINE_ONLY_TYPES below so a genuinely NEW type still
// forces a conscious decision instead of silently passing.
const CAPTAINPAD_CONSUMED_TYPES = new Set([
  'sharedParams', 'paramSchema', 'liveParams', 'mixer', 'deck', 'oscStats', 'audioStatus',
]);

// The Live Touch WebView owns a separate /ws/control client. Keep these out
// of ENGINE_ONLY_TYPES so this contract records their actual consumer.
const TOUCH_CONTROL_WIRE_CONSUMED_TYPES = new Set([
  'touchControlBrightness', 'dimmerState',
  // docs/70 W4: the per-scene Live Touch preset playlist
  // (states/<scene>/live_touch_presets.yaml). Replayed on connect so a pad
  // that joins mid-show renders the saved list immediately. Consumed by the
  // panel's own /ws/control client, NOT by CaptainPad's useEngineState.ts —
  // same posture as the two entries above it.
  'liveTouchPresets',
]);

// Every OTHER type this suite has observed replayed on /ws/control at
// test-write time (see the per-socket `.on('connection', ...)` handlers,
// api_server.js:10150-10306). Not asserted to be UNCONSUMED by CaptainPad —
// only that useEngineState.ts specifically isn't the one reading them.
const ENGINE_ONLY_TYPES = new Set([
  'autopilot', 'colorAutopilot', 'undoState', 'viewOverride', 'audioConfig',
  'audioChainsChanged', 'engineSettings', 'performanceMode', 'effectBanks',
  'timelineState', 'partyConfig', 'layerSettings',
  // docs/52 SPECIAL EVENTS runner. Replayed on connect so a fresh (or
  // woken-up) CaptainPad paints the live stage without waiting a tick. Read by
  // its own hook — CaptainPad/hooks/useSpecialEvents.ts — not by
  // useEngineState.ts, exactly like timelineState beside it.
  'specialEvents',
  // Not part of the connect-replay proper — a periodic render-loop stats
  // tick that can land inside the collection window since it isn't gated
  // by connection timing. Still /ws/control (router-confirmed below).
  'stats', 'fireSyncStats',
]);

test('/ws/control replay includes at minimum {mixer, deck}', async () => {
  const messages = await collectReplayTypes('/ws/control');
  const types = messages.map((m) => m.type);
  assert.ok(types.includes('mixer'), `expected 'mixer' in replay, got [${types.join(', ')}]`);
  assert.ok(types.includes('deck'), `expected 'deck' in replay, got [${types.join(', ')}]`);
});

test('/ws/params replay includes {sharedParams} (NOT paramSchema — see file header correction)', async () => {
  const messages = await collectReplayTypes('/ws/params');
  const types = messages.map((m) => m.type);
  assert.ok(types.includes('sharedParams'), `expected 'sharedParams' in replay, got [${types.join(', ')}]`);
});

test('every /ws/control replayed type is consumed by CaptainPad OR is an explicitly-tracked engine-only type', async () => {
  const messages = await collectReplayTypes('/ws/control');
  const unexpected = [];
  for (const m of messages) {
    assert.equal(typeof m.type, 'string', `every frame must carry a string type: ${JSON.stringify(m)}`);
    if (!CAPTAINPAD_CONSUMED_TYPES.has(m.type)
        && !TOUCH_CONTROL_WIRE_CONSUMED_TYPES.has(m.type)
        && !ENGINE_ONLY_TYPES.has(m.type)) {
      unexpected.push(m.type);
    }
  }
  assert.deepEqual(unexpected, [],
    `NEW /ws/control replay type(s) not in either tracked set — decide whether ` +
    `CaptainPad's useEngineState.ts needs to handle it, then add it to one set: ${unexpected.join(', ')}`);
});

test('every replayed type actually routes to the socket it arrived on (router membership)', async () => {
  const controlMsgs = await collectReplayTypes('/ws/control');
  for (const m of controlMsgs) {
    assert.equal(topicForType(m.type), TOPICS.CONTROL,
      `'${m.type}' was replayed on /ws/control but the router says it belongs on '${topicForType(m.type)}'`);
  }
  const paramsMsgs = await collectReplayTypes('/ws/params');
  for (const m of paramsMsgs) {
    assert.equal(topicForType(m.type), TOPICS.PARAMS,
      `'${m.type}' was replayed on /ws/params but the router says it belongs on '${topicForType(m.type)}'`);
  }
});

test('every replayed frame is JSON-parseable with a string-typed `type` field', async () => {
  // collectReplayTypes already rejects on non-JSON; this test just asserts
  // the collected set is non-empty (sanity that the connection produced
  // something to check) and every entry has the expected shape.
  const messages = await collectReplayTypes('/ws/control');
  assert.ok(messages.length > 0, 'expected at least one replayed frame on /ws/control');
  for (const m of messages) {
    assert.equal(typeof m.type, 'string');
    assert.ok(m.type.length > 0);
  }
});
