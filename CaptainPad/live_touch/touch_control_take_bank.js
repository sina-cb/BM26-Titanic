/* Multi-take Spatial bank — independent buffers, one recorder, concurrent mix.
 *
 * Each slot owns an isolated TouchTakeState machine with its own playback
 * contact key. Slots never share point arrays or timer generations. Recording
 * is exclusive to the selected slot; playback may overlap across slots until
 * the spatial slot pool refuses another contact.
 */
(function installTouchTakeBank(root) {
  'use strict';

  var MAX_TAKES = 4;
  var PLAYBACK_PREFIX = 'take-playback-';

  function contactKeyFor(index) {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_TAKES) {
      throw new Error('TAKE contact key index out of range');
    }
    return PLAYBACK_PREFIX + index;
  }

  function parseContactIndex(contactKey) {
    if (typeof contactKey !== 'string' || !contactKey.startsWith(PLAYBACK_PREFIX)) return null;
    var index = Number(contactKey.slice(PLAYBACK_PREFIX.length));
    if (!Number.isInteger(index) || index < 0 || index >= MAX_TAKES) return null;
    return index;
  }

  function create(options) {
    options = options || {};
    var TakeState = root.TouchTakeState;
    if (!TakeState || typeof TakeState.create !== 'function') {
      throw new Error('TouchTakeState must load before TouchTakeBank');
    }
    var buildEmitSample = options.buildEmitSample;
    var eligibility = options.eligibility || function () { return { ok: true }; };
    var onState = options.onState || function () {};
    var onError = options.onError || function () {};
    var clockNow = options.now;
    var clockSchedule = options.schedule;
    var clockCancel = options.cancel;
    if (typeof buildEmitSample !== 'function') {
      throw new Error('TAKE buildEmitSample factory is required');
    }

    var selectedIndex = 0;
    var slots = [];
    /* TouchTakeState.create() publishes synchronously at the end of boot.
       Per-slot onState must not fan out to the page until every slot exists —
       otherwise paintTakeStatus reads state.slots[0] while slots is still []. */
    var bootstrapping = true;
    for (var index = 0; index < MAX_TAKES; index++) {
      (function (slotIndex) {
        var stateOptions = {
          emitSample: buildEmitSample(contactKeyFor(slotIndex), slotIndex),
          eligibility: eligibility,
          onState: function () { publish(); },
          onError: onError,
        };
        if (typeof clockNow === 'function') stateOptions.now = clockNow;
        if (typeof clockSchedule === 'function') stateOptions.schedule = clockSchedule;
        if (typeof clockCancel === 'function') stateOptions.cancel = clockCancel;
        slots.push({
          index: slotIndex,
          machine: TakeState.create(stateOptions),
        });
      })(index);
    }
    bootstrapping = false;

    function recordingSlot() {
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].machine.state().recording) return slots[i];
      }
      return null;
    }

    function snapshotSlot(slot) {
      var state = slot.machine.state();
      return {
        index: slot.index,
        contactKey: contactKeyFor(slot.index),
        phase: state.phase,
        count: state.count,
        durationMs: state.durationMs,
        playing: state.playing,
        recording: state.recording,
        loop: state.loop,
        loopCount: state.loopCount,
        lastError: state.lastError,
      };
    }

    function snapshot() {
      var slotSnapshots = slots.map(snapshotSlot);
      return {
        selectedIndex: selectedIndex,
        slots: slotSnapshots,
        playingCount: slotSnapshots.filter(function (entry) { return entry.playing; }).length,
        recordingIndex: (function () {
          var active = recordingSlot();
          return active ? active.index : null;
        }()),
      };
    }

    function publish() {
      if (bootstrapping) return;
      onState(snapshot());
    }

    function requireSelectable(index) {
      if (!Number.isInteger(index) || index < 0 || index >= MAX_TAKES) {
        throw new Error('TAKE slot index out of range');
      }
      var active = recordingSlot();
      if (active && active.index !== index) {
        throw new Error('TAKE cannot switch slots while slot ' + (active.index + 1) + ' is recording');
      }
    }

    function selectedMachine() { return slots[selectedIndex].machine; }

    function select(index) {
      requireSelectable(index);
      selectedIndex = index;
      publish();
      return index;
    }

    function replaceAll(lists) {
      if (!Array.isArray(lists)) throw new Error('TAKE bank replaceAll requires an array');
      if (lists.length > MAX_TAKES) throw new Error('TAKE bank exceeds the ' + MAX_TAKES + '-slot limit');
      return cleanup('replace-all').then(function () {
        for (var i = 0; i < MAX_TAKES; i++) {
          var list = Array.isArray(lists[i]) ? lists[i] : [];
          slots[i].machine.replace(list);
        }
        publish();
      });
    }

    function cleanup(reason) {
      return Promise.all(slots.map(function (slot) {
        var state = slot.machine.state();
        if (state.recording) slot.machine.stopRecording();
        if (state.playing || state.phase === 'settling' || state.contactDown) {
          return slot.machine.stop(reason || 'cleanup');
        }
        return Promise.resolve();
      })).then(function () { publish(); });
    }

    publish();
    return {
      limits: { maxTakes: MAX_TAKES, maxConcurrentPlayback: MAX_TAKES },
      contactKeyFor: contactKeyFor,
      parseContactIndex: parseContactIndex,
      select: select,
      selectedIndex: function () { return selectedIndex; },
      machineAt: function (index) { return slots[index].machine; },
      state: snapshot,
      recordPoint: function (u, v, down) { return selectedMachine().recordPoint(u, v, down); },
      startRecording: function () { return selectedMachine().startRecording(); },
      stopRecording: function () { return selectedMachine().stopRecording(); },
      play: function (wantLoop) { return selectedMachine().play(wantLoop); },
      stop: function (reason) { return selectedMachine().stop(reason); },
      stopAll: function (reason) {
        return Promise.all(slots.map(function (slot) { return slot.machine.stop(reason || 'stop-all'); }))
          .then(function () { publish(); });
      },
      clear: function () { return selectedMachine().clear(); },
      deleteSelected: function () { return selectedMachine().clear(); },
      exportTake: function (index) {
        var slotIndex = index === undefined ? selectedIndex : index;
        return slots[slotIndex].machine.exportTake();
      },
      exportAll: function () { return slots.map(function (slot) { return slot.machine.exportTake(); }); },
      replaceTake: function (index, list) {
        requireSelectable(index);
        slots[index].machine.replace(list);
        publish();
      },
      replaceAll: replaceAll,
      cleanup: cleanup,
    };
  }

  var api = {
    create: create,
    maxTakes: MAX_TAKES,
    playbackPrefix: PLAYBACK_PREFIX,
    contactKeyFor: contactKeyFor,
    parseContactIndex: parseContactIndex,
  };
  root.TouchTakeBank = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
