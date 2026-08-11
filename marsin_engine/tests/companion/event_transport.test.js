import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_EVENT_SPECS,
  AudioEventTransport,
  EVENT_SEQUENCE_MAX,
} from '../../audio/companion/event_transport.js';

function values(overrides = {}) {
  return Object.fromEntries(AUDIO_EVENT_SPECS.map(({ key }) => [key, overrides[key] ?? 0]));
}

test('every event survives every throttle phase through a forced sequence update', () => {
  for (let phase = 0; phase < 11; phase++) {
    const transport = new AudioEventTransport({ envelopeMs: 100 });
    const sent = [];
    for (let hop = 0; hop < 33; hop++) {
      const fire = hop === phase;
      const outputs = transport.tick(values({ audioDownbeat: fire ? 1 : 0 }), 10);
      const downbeat = outputs.find(({ key }) => key === 'audioDownbeat');
      const throttleOpen = hop % 11 === 0;
      if (downbeat.rising || throttleOpen) sent.push(downbeat);
    }
    assert.equal(sent.filter(({ rising }) => rising).length, 1, `phase ${phase}`);
    assert.equal(sent.find(({ rising }) => rising).sequence, 1, `phase ${phase}`);
  }
});

test('rising edges are exactly-once while duplicate high hops are ignored', () => {
  const transport = new AudioEventTransport();
  const sequence = [];
  for (const raw of [0, 1, 1, 1, 0, 1, 0]) {
    const event = transport.tick(values({ audioSwitchPattern: raw }), 10)
      .find(({ key }) => key === 'audioSwitchPattern');
    if (event.rising) sequence.push(event.sequence);
  }
  assert.deepEqual(sequence, [1, 2]);
});

test('back-to-back one-hop events and all five event types are independent', () => {
  const transport = new AudioEventTransport();
  const counts = Object.fromEntries(AUDIO_EVENT_SPECS.map(({ key }) => [key, 0]));
  for (let cycle = 0; cycle < 3; cycle++) {
    const high = transport.tick(values(Object.fromEntries(AUDIO_EVENT_SPECS.map(({ key }) => [key, 1]))), 5);
    for (const event of high) {
      assert.equal(event.rising, true);
      counts[event.key] = event.sequence;
    }
    transport.tick(values(), 5);
  }
  assert.deepEqual(Object.values(counts), [3, 3, 3, 3, 3]);
});

test('restart starts clean and creates no false event', () => {
  const first = new AudioEventTransport();
  first.tick(values({ audioTrackChange: 1 }), 10);
  const restarted = new AudioEventTransport();
  const idle = restarted.tick(values(), 10);
  assert.equal(idle.some(({ rising }) => rising), false);
  assert.equal(idle.every(({ sequence }) => sequence === 0), true);
  const event = restarted.tick(values({ audioTrackChange: 1 }), 10)
    .find(({ key }) => key === 'audioTrackChange');
  assert.equal(event.rising, true);
  assert.equal(event.sequence, 1);
});

test('envelope is bounded, decays to exact zero, and sequence wraps safely', () => {
  const transport = new AudioEventTransport({ envelopeMs: 100 });
  const first = transport.tick(values({ audioSwitchColor: 1 }), 10)
    .find(({ key }) => key === 'audioSwitchColor');
  assert.equal(first.envelope, 1);
  transport._state.get('audioSwitchColor').sequence = EVENT_SEQUENCE_MAX;
  transport.tick(values(), 40);
  const decayed = transport.tick(values(), 60)
    .find(({ key }) => key === 'audioSwitchColor');
  assert.equal(decayed.envelope, 0);
  const wrapped = transport.tick(values({ audioSwitchColor: 1 }), 1)
    .find(({ key }) => key === 'audioSwitchColor');
  assert.equal(wrapped.sequence, 1);
});

test('invalid timing or missing event inputs fail loudly', () => {
  const transport = new AudioEventTransport();
  assert.throws(() => transport.tick({}, 10), /audioDownbeat/);
  assert.throws(() => transport.tick(values(), -1), />= 0/);
});
