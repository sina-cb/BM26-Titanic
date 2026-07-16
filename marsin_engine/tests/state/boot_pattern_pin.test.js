// Unit tests for the BOOT `--pattern` PIN (operator-intent ruling 2026-07-07,
// full-stack smoke report 20260707_2 anomaly 2): an explicit CLI `--pattern`
// suspends a restored-ACTIVE deck pattern autopilot at boot until an operator
// re-enables it (CaptainPad deck ▶ / POST /autopilot {"active":true}).
//
// Covers:
//   1. The pure decision seam `bootPatternPinDecision` (api_server.js).
//   2. `Autopilot.suspend()` — runtime-only: clears the armed timer, flips the
//      in-memory active flag, and NEVER persists to config.yaml.
//   3. The exact boot ordering api_server uses (suspend → setProfile →
//      start()) — no cycle timer is armed and no swap ever fires.
//   4. Operator re-enable (updateState({active:true})) resumes cycling and is
//      the FIRST thing that persists.
//
// No engine boot, no port binding, no tracked-file writes: saveConfig is
// stubbed on every daemon instance (and on the prototype during construction,
// in case a future config.yaml loses its playlist block).
//
// Run:  cd marsin_engine && node --test tests/boot_pattern_pin.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootPatternPinDecision } from '../../lib/api_server.js';
import { Autopilot } from '../../lib/autopilot.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a daemon whose saveConfig is a counting stub (never touches disk) and
// whose in-memory playlist state is fully controlled by the test.
function makeDaemon({ active, changePattern } = {}) {
  const origSave = Autopilot.prototype.saveConfig;
  Autopilot.prototype.saveConfig = function () {};
  let ap;
  try {
    ap = new Autopilot(() => [], '.', () => null, changePattern || (() => {}), null);
  } finally {
    Autopilot.prototype.saveConfig = origSave;
  }
  ap._saveCount = 0;
  ap.saveConfig = function () { this._saveCount++; };
  ap.config.playlist = { active: !!active, delay_s: '10', shuffle: false };
  return ap;
}

// A minimal timer profile (what armAutopilotProfile injects) with a tiny
// delay so tests run fast.
const fastProfile = (ms) => ({ nextDelayMs: () => ms });

// ── 1. Pure decision seam ───────────────────────────────────────────────────

test('pin decision: CLI pattern + restored-active daemon → suspend', () => {
  const d = bootPatternPinDecision({
    cliPattern: '01_cylon_sweep', daemonActive: true, deckMirrorActive: true,
  });
  assert.equal(d.suspend, true);
  assert.match(d.reason, /deck autopilot is ACTIVE/);
});

test('pin decision: CLI pattern + only the deck_state mirror active → suspend', () => {
  const d = bootPatternPinDecision({
    cliPattern: '01_cylon_sweep', daemonActive: false, deckMirrorActive: true,
  });
  assert.equal(d.suspend, true);
  assert.match(d.reason, /mirrors autopilot ACTIVE/);
});

test('pin decision: CLI pattern + autopilot restored INACTIVE → no suspend', () => {
  const d = bootPatternPinDecision({
    cliPattern: '01_cylon_sweep', daemonActive: false, deckMirrorActive: false,
  });
  assert.deepEqual(d, { suspend: false, reason: null });
});

test('pin decision: no / empty CLI pattern → never suspends', () => {
  for (const cliPattern of [null, undefined, '']) {
    const d = bootPatternPinDecision({
      cliPattern, daemonActive: true, deckMirrorActive: true,
    });
    assert.deepEqual(d, { suspend: false, reason: null }, `cliPattern=${cliPattern}`);
  }
});

// ── 2. suspend(): runtime-only, clears the timer, never persists ────────────

test('suspend() clears an armed cycle timer and does NOT persist', () => {
  const ap = makeDaemon({ active: true });
  ap.setProfile(fastProfile(60_000)); // arms a (long) timer via _scheduleNext
  assert.equal(typeof ap.nextSwapAtMs, 'number', 'timer armed while active');
  assert.ok(ap.cycleTimer, 'cycleTimer set while active');

  ap.suspend();
  assert.equal(ap.state.active, false, 'in-memory active flag cleared');
  assert.equal(ap.nextSwapAtMs, null, 'countdown cleared');
  assert.equal(ap.cycleTimer, null, 'timer cleared');
  assert.equal(ap._saveCount, 0, 'suspend() must never write config.yaml');
});

// ── 3. Boot ordering: suspend → setProfile → start() (api_server order) ─────

test('boot order suspend→arm→start never fires a swap', async () => {
  let swaps = 0;
  const ap = makeDaemon({ active: true, changePattern: () => { swaps++; } });

  // Exact api_server boot sequence for a pinned boot:
  ap.suspend();                 // BOOT PATTERN PIN block
  ap.setProfile(fastProfile(10)); // armAutopilotProfile(...)
  ap.start();                   // autopilot.start()

  assert.equal(ap.nextSwapAtMs, null, 'no cycle scheduled after pinned boot');
  assert.equal(ap.cycleTimer, null, 'no timer armed after pinned boot');
  await sleep(60);              // several would-be 10 ms cycles
  assert.equal(swaps, 0, 'pinned pattern was never cycled away');
  assert.equal(ap._saveCount, 0, 'pinned boot persisted nothing');
});

// ── 4. Operator re-enable resumes cycling and persists ──────────────────────

test('operator re-enable after a pinned boot resumes cycling', async () => {
  let swaps = 0;
  const ap = makeDaemon({ active: true, changePattern: () => { swaps++; } });
  ap.suspend();
  ap.setProfile(fastProfile(10));
  ap.start();
  assert.equal(swaps, 0);

  // The operator's explicit toggle (POST /autopilot → updateState) is the
  // first thing allowed to persist — and it resumes the daemon.
  ap.updateState({ active: true });
  assert.ok(ap._saveCount > 0, 'operator toggle persists');
  assert.equal(typeof ap.nextSwapAtMs, 'number', 'cycle re-armed');
  // Poll for the first swap (10 ms profile delay; generous ceiling for CI).
  const deadline = Date.now() + 2000;
  while (swaps === 0 && Date.now() < deadline) await sleep(10);
  assert.ok(swaps >= 1, 'autopilot cycles again after the operator re-enables');

  ap.suspend(); // teardown: clear the self-rescheduling timer
});
