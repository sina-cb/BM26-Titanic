(function (root) {
  'use strict';

  function requireStep(steps, name) {
    if (!steps || typeof steps[name] !== 'function') {
      throw new Error('Live Touch lifecycle is missing step ' + name);
    }
    return steps[name];
  }

  /* One explicit transaction boundary for ARM. Keeping this orchestration
     independent makes the safety order executable in tests:
       verify → lease → stage → assert → activate → land → ARMED. */
  function arm(steps) {
    var verify = requireStep(steps, 'verify');
    var acquireLease = requireStep(steps, 'acquireLease');
    var stage = requireStep(steps, 'stage');
    var assertState = requireStep(steps, 'assertState');
    var activate = requireStep(steps, 'activate');
    var waitForLanding = requireStep(steps, 'waitForLanding');
    var markArmed = requireStep(steps, 'markArmed');
    var isCancelled = requireStep(steps, 'isCancelled');

    function guarded(step) {
      return function () {
        if (isCancelled()) throw new Error('Live Touch ARM was cancelled by page lifecycle');
        return Promise.resolve().then(step).then(function (value) {
          if (isCancelled()) throw new Error('Live Touch ARM was cancelled by page lifecycle');
          return value;
        });
      };
    }

    return Promise.resolve()
      .then(guarded(verify))
      .then(guarded(acquireLease))
      .then(guarded(stage))
      .then(guarded(assertState))
      .then(guarded(activate))
      .then(guarded(waitForLanding))
      .then(guarded(markArmed));
  }

  /* Decide the next authoritative action for one queued parent intent. A
     navigation request can arrive after an older handback already made this
     surface idle; it still must activate/prove its own destination before ACK.
     Background while already idle is the only request that may ACK directly. */
  function planHandoff(phase, request) {
    if (!request || (request.target !== 'deck' && request.target !== 'mixer')) {
      throw new Error('Live Touch handoff has an invalid destination');
    }
    if (request.reason !== 'navigation' && request.reason !== 'background') {
      throw new Error('Live Touch handoff has an invalid reason');
    }
    if (phase === 'armed') return 'handback';
    if (phase !== 'idle') return 'wait';
    if (request.reason === 'background' && request.forceDestination !== true) return 'ack';
    return 'activate';
  }

  /* A persisted page may resume promises that were frozen halfway through an
     ARM or handback. Any non-idle phase therefore belongs to the page that was
     hidden, not the restored visit. */
  function shouldFailClosedAfterPageShow(persisted, phase) {
    return persisted === true && phase !== 'idle';
  }

  function pageShowRecovery(persisted, phase) {
    if (!shouldFailClosedAfterPageShow(persisted, phase)) return 'none';
    if (phase === 'arming') return 'cancel_arm';
    if (phase === 'armed') return 'handback';
    if (phase === 'disarming') return 'continue_handback';
    throw new Error('Live Touch has an invalid lifecycle phase');
  }

  /* Live brightness and Dimmer Rack authority have independent monotonic
     revisions. Cross-transport delivery may interleave, so neither half may
     regress merely because the other half is current. */
  function revisionAcceptance(currentLive, currentRack, incomingLive, incomingRack) {
    [incomingLive, incomingRack].forEach(function (revision) {
      if (!Number.isInteger(revision) || revision < 0) {
        throw new Error('Live Touch brightness revisions must be non-negative integers');
      }
    });
    [currentLive, currentRack].forEach(function (revision) {
      if (revision !== null && (!Number.isInteger(revision) || revision < 0)) {
        throw new Error('Live Touch current revisions are invalid');
      }
    });
    var live = currentLive === null || incomingLive >= currentLive;
    var rack = currentRack === null || incomingRack >= currentRack;
    return Object.freeze({ live: live, rack: rack, effective: live && rack });
  }

  root.TouchControlLifecycle = Object.freeze({
    arm: arm,
    planHandoff: planHandoff,
    pageShowRecovery: pageShowRecovery,
    revisionAcceptance: revisionAcceptance,
    shouldFailClosedAfterPageShow: shouldFailClosedAfterPageShow,
  });
}(window));
