// SIZE lock — the global spatial-scale param is pinned at 0.5 (coordinate
// identity) and every write path refuses to change it. Operator ruling
// 2026-08-06; see marsin_engine/lib/size_lock.js and
// .agent/reports/202608/20260806_182_size_lock.md.
//
// Run:  cd marsin_engine && node --test tests/mixer/size_lock.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import yaml from 'js-yaml';

import { ParamCenter } from '../../lib/param_center.js';
import { StateManager } from '../../lib/state_manager.js';
import { LOCKED_SIZE, SIZE_LOCK_REASON, isLockedSize } from '../../lib/size_lock.js';

// A non-locked size that actually shipped in the titanic scene and started
// this whole thread (mult ≈ 2.13 → pattern coords compressed to 0 → ~0.47).
const STRAY_SIZE = 0.773;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tmpStatePath(seed) {
  const p = path.join(tmpDir('sizelock_pc_'), 'state.yaml');
  if (seed !== undefined) fs.writeFileSync(p, yaml.dump(seed));
  return p;
}

/** Run `fn` with console.error captured; returns the captured lines. */
function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    fn(lines);
  } finally {
    console.error = original;
  }
  return lines;
}

// ── The constant itself ────────────────────────────────────────────────────

test('LOCKED_SIZE is the identity point of the engine size curve', () => {
  // engine.js globalSizeMultiplier(): mult = SIZE_MIN * (MAX/MIN)^size
  //                                       = 0.25 * 16^size  →  0.5 ⇒ 1.0×
  const mult = 0.25 * Math.pow(16, LOCKED_SIZE);
  assert.ok(Math.abs(mult - 1.0) < 1e-12, `LOCKED_SIZE must be identity, got ${mult}×`);
  assert.equal(isLockedSize(LOCKED_SIZE), true);
  assert.equal(isLockedSize(STRAY_SIZE), false);
  assert.equal(isLockedSize('0.5'), false, 'a string is a malformed write, not the pin');
});

// ── Boot pin ───────────────────────────────────────────────────────────────

test('a persisted non-locked size is IGNORED at boot and reported loudly', () => {
  const statePath = tmpStatePath({ size: STRAY_SIZE, rotate: 0.25 });
  let pc;
  const logs = captureErrors(() => { pc = new ParamCenter(statePath); });

  assert.equal(pc.getAll().size, LOCKED_SIZE, 'effective size is the pin');
  assert.equal(pc.get('size'), LOCKED_SIZE);
  assert.equal(pc.getAll().rotate, 0.25, 'every other persisted param still restores');

  const report = pc.getSizeLockReport();
  assert.equal(report.clean, false);
  assert.equal(report.restoreOverrideCount, 1);
  assert.equal(report.restoreOverrides[0].value, STRAY_SIZE);
  assert.equal(report.restoreOverrides[0].file, statePath, 'the report NAMES the file');

  assert.equal(logs.length, 1, 'exactly one loud line');
  assert.match(logs[0], /size-lock/);
  assert.match(logs[0], /0\.773/, 'the ignored value is named');
  assert.ok(logs[0].includes(statePath), 'the file is named in the log');
});

test('a clean persisted size (0.5) restores silently — no false warning', () => {
  const statePath = tmpStatePath({ size: LOCKED_SIZE });
  let pc;
  const logs = captureErrors(() => { pc = new ParamCenter(statePath); });

  assert.equal(pc.getAll().size, LOCKED_SIZE);
  assert.equal(pc.getSizeLockReport().clean, true);
  assert.equal(pc.getSizeLockWarning(), null);
  assert.equal(logs.length, 0);
});

// ── Runtime refusal — every set path ───────────────────────────────────────

test('set() refuses a size write from any source, loudly, without throwing', () => {
  const pc = new ParamCenter(tmpStatePath());
  let result;
  const logs = captureErrors(() => { result = pc.set('size', 0.9, 'api', 'ipad-001'); });

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, SIZE_LOCK_REASON);
  assert.equal(result.lockedValue, LOCKED_SIZE);
  assert.equal(result.noop, false);
  assert.match(result.message, /LOCKED/);
  assert.equal(pc.getAll().size, LOCKED_SIZE, 'the value did not move');

  assert.equal(logs.length, 1);
  assert.match(logs[0], /REFUSED size=0\.9/);
  assert.match(logs[0], /source='api'/);

  const report = pc.getSizeLockReport();
  assert.equal(report.refusalCount, 1);
  assert.equal(report.refusalsBySource.api, 1);
  assert.deepEqual(report.lastRefusal, { value: 0.9, source: 'api', origin: 'ipad-001' });
});

test('a set() that ASKS for the pinned value is a no-op, not a violation', () => {
  const pc = new ParamCenter(tmpStatePath());
  let result;
  const logs = captureErrors(() => { result = pc.set('size', LOCKED_SIZE, 'timeline'); });

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, SIZE_LOCK_REASON);
  assert.equal(result.noop, true, 'flagged so callers skip the error path');
  assert.equal(pc.getSizeLockReport().clean, true, 'no warning for a harmless write');
  assert.equal(logs.length, 0);
});

test('setMany() drops size from the batch and applies every other write', () => {
  const pc = new ParamCenter(tmpStatePath());
  let out;
  captureErrors(() => {
    out = pc.setMany([
      { kind: 'scalar', key: 'size', value: 0.2 },
      { kind: 'scalar', key: 'rotate', value: 0.75 },
      { kind: 'hsv', key: 'colorPalette1', field: 'h', value: 0.3 },
    ], 'osc', 'osc:desk');
  });

  assert.deepEqual(out.changedKeys, ['rotate', 'colorPalette1'], 'size never lands');
  assert.equal(pc.getAll().size, LOCKED_SIZE);
  assert.equal(pc.getAll().rotate, 0.75);
  assert.equal(pc.getSizeLockReport().refusalsBySource.osc, 1);
});

test('a source lock cannot smuggle a size write through', () => {
  // Even when the writer OWNS the global lease, the size pin wins — it is
  // checked before source arbitration.
  const pc = new ParamCenter(tmpStatePath());
  pc.setSourceLock({ mode: 'global', source: 'osc' });
  let result;
  captureErrors(() => { result = pc.set('size', 0.1, 'osc'); });
  assert.equal(result.reason, SIZE_LOCK_REASON);
  assert.equal(pc.getAll().size, LOCKED_SIZE);
});

test('the refused write never reaches WASM (size stays out of the control map)', () => {
  // `size` is engineOwned, so registerChannel must never bind it to a
  // pattern export — a pattern exporting `size` would otherwise be a second
  // write path around the lock.
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { fake: true }, [
    { id: 111, name: 'size' },
    { id: 222, name: 'rotate' },
  ]);
  assert.equal(pc.isSharedExport('deck', 'size'), false);
  assert.equal(pc.isSharedExport('deck', 'rotate'), true);
});

// ── State restore (boot + snapshot recall) ─────────────────────────────────

test('StateManager.applyGlobalsState refuses a saved size and names the file', () => {
  const dir = tmpDir('sizelock_sm_');
  const sm = new StateManager(dir);
  const pc = new ParamCenter(tmpStatePath());

  const globalsState = {
    params: {
      revision: 42,
      sourceLock: null,
      params: {
        size: { value: STRAY_SIZE, lastSource: 'init' },
        rotate: { value: 0.5, lastSource: 'init' },
      },
    },
  };

  const logs = captureErrors(() => {
    sm.applyGlobalsState(globalsState, pc, null, null);
  });

  assert.equal(pc.getAll().size, LOCKED_SIZE);
  assert.equal(pc.getAll().rotate, 0.5, 'the rest of the saved globals still restore');

  const report = pc.getSizeLockReport();
  assert.equal(report.restoreOverrideCount, 1);
  assert.equal(report.restoreOverrides[0].file, path.join(dir, 'globals_state.yaml'));
  assert.ok(
    logs.some(l => l.includes('globals_state.yaml') && l.includes('0.773')),
    'the loud line names globals_state.yaml AND the ignored value');
});

test('applyGlobalsState with a clean saved size stays silent', () => {
  const sm = new StateManager(tmpDir('sizelock_sm_'));
  const pc = new ParamCenter(tmpStatePath());
  const logs = captureErrors(() => {
    sm.applyGlobalsState({ params: { params: { size: { value: LOCKED_SIZE } } } }, pc, null, null);
  });
  assert.equal(pc.getSizeLockReport().clean, true);
  assert.equal(logs.length, 0);
});

// ── Persistence ────────────────────────────────────────────────────────────

test('state save persists ONLY the locked size, whatever was attempted', () => {
  const statePath = tmpStatePath({ size: STRAY_SIZE });
  let pc;
  captureErrors(() => {
    pc = new ParamCenter(statePath);
    pc.set('size', 0.95, 'api');
  });
  pc._writeToDisk();

  const written = yaml.load(fs.readFileSync(statePath, 'utf8'));
  assert.equal(written.size, LOCKED_SIZE, 'the stray value never round-trips to disk');
});

test('the canonical state (globals_state.yaml + WS broadcasts) carries 0.5', () => {
  const statePath = tmpStatePath({ size: STRAY_SIZE });
  let pc;
  captureErrors(() => { pc = new ParamCenter(statePath); });
  assert.equal(pc.getCanonicalState().params.size.value, LOCKED_SIZE);
});

// ── Operator-visible warning ───────────────────────────────────────────────

test('the warning line names the file and the refusals, and never self-clears', () => {
  const statePath = tmpStatePath({ size: STRAY_SIZE });
  let pc;
  captureErrors(() => {
    pc = new ParamCenter(statePath);
    pc.set('size', 0.9, 'ws');
  });

  const warning = pc.getSizeLockWarning();
  assert.match(warning, /SIZE locked at 0\.5/);
  assert.match(warning, /0\.773/);
  assert.match(warning, /refused/);

  // A later legitimate write to another param does not clear it.
  pc.set('rotate', 0.2, 'api');
  assert.equal(pc.getSizeLockWarning(), warning, 'the warning is sticky');
});

test('getSchema marks size locked so a UI renders it read-only', () => {
  const schema = new ParamCenter(tmpStatePath()).getSchema();
  const size = schema.find(e => e.key === 'size');
  assert.ok(size);
  assert.equal(size.locked, true);
  assert.equal(size.lockedValue, LOCKED_SIZE);
  assert.equal(size.default, LOCKED_SIZE);
  assert.equal(size.engineOwned, true);

  const rotate = schema.find(e => e.key === 'rotate');
  assert.equal(rotate.locked, false, 'no other param is locked');
  assert.equal(rotate.lockedValue, undefined);
});

test('internal drift is caught and corrected at the READ side', () => {
  // Defence in depth: if a future refactor opens a write path that skips the
  // guard, the render loop / persistence must still see the pin — loudly.
  const pc = new ParamCenter(tmpStatePath());
  pc._store.size.value = 0.9; // simulate a hypothetical bypass
  let all;
  const logs = captureErrors(() => { all = pc.getAll(); });
  assert.equal(all.size, LOCKED_SIZE);
  assert.equal(pc._store.size.value, LOCKED_SIZE, 'the store is repaired');
  assert.ok(logs.some(l => l.includes('drifted')));
  assert.equal(pc.getSizeLockReport().clean, false, 'the drift is reported to the operator');
});
