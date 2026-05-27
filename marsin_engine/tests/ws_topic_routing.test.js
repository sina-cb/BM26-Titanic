// Invariant tests for the WS topic routing table.
//
// The routing table (lib/ws_topic_routing.js) is the single source of
// truth for which engine broadcast `type` lives on which client-facing
// socket. These tests pin the contract:
//
//   1. Every type maps to exactly one of the four known topics.
//   2. Vis frames stay on /ws/viz (never leak onto control / params).
//   3. liveParams stays on /ws/signals (never bleeds onto control or
//      onto the same socket as steady CPC writes).
//   4. sharedParams stays on /ws/params.
//   5. topicForType() throws — never silently routes — on an unknown
//      type. A typo in a payload should crash a unit test, not become
//      a broadcast that disappears at runtime.
//
// Run with:
//   cd marsin_engine && node --test tests/ws_topic_routing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPICS,
  topicForType,
  knownTypes,
  getRoutingTable,
} from '../lib/ws_topic_routing.js';

const ALL_TOPIC_VALUES = new Set(Object.values(TOPICS));

test('TOPICS exposes exactly four named topics', () => {
  assert.equal(ALL_TOPIC_VALUES.size, 4);
  for (const t of ['control', 'params', 'signals', 'viz']) {
    assert.ok(ALL_TOPIC_VALUES.has(t), `missing topic: ${t}`);
  }
});

test('every known type maps to exactly one valid topic', () => {
  const table = getRoutingTable();
  for (const [type, topic] of Object.entries(table)) {
    assert.ok(ALL_TOPIC_VALUES.has(topic),
      `type "${type}" maps to unknown topic "${topic}"`);
  }
});

test('high-volume frames are isolated on /ws/viz', () => {
  // Vis frames are by far the largest payloads we ship (10 Hz × N
  // channels × pixel buffer). They MUST stay isolated so the audio
  // tab can avoid them by simply not opening /ws/viz.
  assert.equal(topicForType('vis'), TOPICS.VIZ);
});

test('audio analyser live signals stay on /ws/signals', () => {
  // liveParams is the audio analyser's high-rate (15-30 Hz) output.
  // Mixing it back into /ws/control would re-introduce the exact
  // bug the topic split exists to fix.
  assert.equal(topicForType('liveParams'), TOPICS.SIGNALS);
});

test('CPC steady writes ride /ws/params, separate from signals', () => {
  assert.equal(topicForType('sharedParams'), TOPICS.PARAMS);
  // The two CPC sockets must NOT share a topic — that's the whole
  // point of the split.
  assert.notEqual(
    topicForType('sharedParams'),
    topicForType('liveParams'),
    'sharedParams and liveParams collided onto the same topic'
  );
});

test('modulationState rides /ws/params alongside sharedParams', () => {
  // Frozen-decision (modulation contract Phase 0): the per-frame
  // modulation snapshot is a CPC-state delta, not a live signal —
  // it changes only when a mapping/value moves. Keeping it on
  // /ws/params lets the deck's slider-ghost overlay subscribe
  // without pulling in audio-rate liveParams traffic.
  assert.equal(topicForType('modulationState'), TOPICS.PARAMS);
});

test('UI/state events ride /ws/control', () => {
  // Spot check the most important control-topic types. If any of
  // these get re-routed away from control, the deck/mixer will go
  // dark for them. Adding them all here is intentional — this list
  // doubles as the "what does CaptainPad listen to" contract.
  const controlTypes = [
    'mixer',
    'deck',
    'pattern',
    'autopilot',
    'viewOverride',
    'deckTransitionConfig',
    'deckSwapStarted',
    'deckSwapComplete',
    'mixerTransitionStarted',
    'mixerTransitionComplete',
    'mixerTransitionRejected',
    'globalEffectSlots',
    'globalEffectMacroStatus',
    'playlistLibrary',
    'playlistSaved',
    'playlistDeleted',
    'channelPlaylistData',
    'playlistEntryCaptured',
    'paramRejected',
    'audioStatus',
    'oscStats',
    'stats',
  ];
  for (const t of controlTypes) {
    assert.equal(topicForType(t), TOPICS.CONTROL,
      `expected control topic for "${t}"`);
  }
});

test('unknown types throw — no silent fallback', () => {
  // The bug class we are guarding against: a developer adds a new
  // broadcast at a call site and forgets to update the routing
  // table. A silent default would let the message disappear at
  // runtime (no socket subscribed) or leak onto every socket
  // (high-volume regression). topicForType() must surface this.
  assert.throws(
    () => topicForType('definitely_not_a_real_type_42'),
    /unknown message type/i,
  );
  assert.throws(
    () => topicForType(''),
    /no .type field|unknown/i,
  );
  assert.throws(
    () => topicForType(undefined),
    /no .type field|unknown/i,
  );
});

test('knownTypes() lists every routing entry', () => {
  const types = knownTypes();
  const table = getRoutingTable();
  assert.equal(types.length, Object.keys(table).length);
  for (const t of types) {
    assert.ok(table[t], `knownTypes returned "${t}" but it has no routing entry`);
  }
});
