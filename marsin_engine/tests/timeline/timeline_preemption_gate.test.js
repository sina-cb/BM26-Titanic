import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelinePreemptionGate } from '../../lib/timeline/timeline_preemption_gate.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('does nothing when Live Touch is not armed', async () => {
  let disarms = 0;
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => null,
    forceDisarmLiveTouch: () => { disarms += 1; },
    confirmLiveTouchReleased: () => true,
  });

  assert.deepEqual(await gate.preempt('POST /timeline/plans'), {
    preempted: false,
    ownerId: null,
  });
  assert.equal(disarms, 0);
  assert.equal(gate.isPending(), false);
});

test('clears Live Touch without applying a separate Timeline operation', async () => {
  let ownerId = 'live-panel';
  const order = [];
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => ownerId,
    forceDisarmLiveTouch: operation => {
      order.push(`disarm:${operation}`);
      ownerId = null;
      return true;
    },
    confirmLiveTouchReleased: () => ownerId === null,
  });

  assert.deepEqual(await gate.preempt('PUT /party-config'), {
    preempted: true,
    ownerId: 'live-panel',
  });
  assert.deepEqual(order, ['disarm:PUT /party-config']);
  assert.equal(gate.isPending(), false);
});

test('concurrent mutations share one handoff and cannot double-disarm', async () => {
  let ownerId = 'live-panel';
  let disarms = 0;
  const release = deferred();
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => ownerId,
    forceDisarmLiveTouch: () => {
      disarms += 1;
      ownerId = null;
      release.resolve();
      return true;
    },
    confirmLiveTouchReleased: () => ownerId === null,
  });

  const first = gate.preempt('POST /timeline/plans');
  const second = gate.preempt('PUT /party-config');
  assert.equal(gate.isPending(), true);
  assert.equal(disarms, 1);

  await release.promise;
  assert.deepEqual(await Promise.all([first, second]), [
    { preempted: true, ownerId: 'live-panel' },
    { preempted: true, ownerId: 'live-panel' },
  ]);
  assert.equal(disarms, 1);
  assert.equal(gate.isPending(), false);
});

test('fails when forced release is not confirmed', async () => {
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => 'live-panel',
    forceDisarmLiveTouch: () => false,
    confirmLiveTouchReleased: () => false,
  });

  await assert.rejects(
    gate.preempt('POST /timeline/cues/cue-1/fire'),
    /did not release/,
  );
  assert.equal(gate.isPending(), false);
});

test('propagates forced-release failure and keeps later attempts available', async () => {
  let ownerId = 'first-owner';
  let attempts = 0;
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => ownerId,
    forceDisarmLiveTouch: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('release failed');
      ownerId = null;
      return true;
    },
    confirmLiveTouchReleased: () => ownerId === null,
  });

  await assert.rejects(gate.preempt('POST /timeline/travel'), /release failed/);
  assert.equal(gate.isPending(), false);

  ownerId = 'second-owner';
  assert.deepEqual(await gate.preempt('POST /timeline/resume'), {
    preempted: true,
    ownerId: 'second-owner',
  });
  assert.equal(attempts, 2);
});

test('detects a Live Touch re-arm before dispatch', async () => {
  let ownerId = 'live-panel';
  let confirmations = 0;
  const gate = createTimelinePreemptionGate({
    currentLiveTouchOwner: () => ownerId,
    forceDisarmLiveTouch: () => {
      ownerId = null;
      return true;
    },
    confirmLiveTouchReleased: () => {
      confirmations += 1;
      if (confirmations === 1) return ownerId === null;
      ownerId = 'racing-panel';
      return false;
    },
  });

  await assert.rejects(
    gate.preempt('POST /timeline/plan/activate'),
    /re-armed during Timeline handoff/,
  );
  assert.equal(gate.isPending(), false);
});
