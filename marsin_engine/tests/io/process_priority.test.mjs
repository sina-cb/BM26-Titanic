// Unit tests for tools/process_priority.cjs — the OS process-priority option
// plumbing shared by the engine, launcher, start.js, and the sACN bridges.
//
// Scope (per .agent/os/testing.md): this is a UNIT suite. It covers the pure
// option plumbing — request normalization, the precedence resolver, the
// nice→class mapping, and the exact `[label] requested=X achieved=Y` log-line
// CONTRACT. It deliberately does NOT call the OS-touching elevate* functions:
// changing the test runner's real priority is a side effect, and that path is
// proven separately by the scratch-engine integration check (external
// Get-Process PriorityClass) documented in report 20260724_20.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pp = require('../../../tools/process_priority.cjs');

test('normalizePriorityRequest: canonicalizes the two SAFE targets', () => {
  assert.equal(pp.normalizePriorityRequest('high'), 'high');
  assert.equal(pp.normalizePriorityRequest('realtime'), 'realtime');
  assert.equal(pp.normalizePriorityRequest('HIGH'), 'high');
  assert.equal(pp.normalizePriorityRequest(' RealTime '), 'realtime');
});

test('normalizePriorityRequest: empty/absent resolves to the fallback', () => {
  assert.equal(pp.normalizePriorityRequest(undefined, { fallback: 'high' }), 'high');
  assert.equal(pp.normalizePriorityRequest(null, { fallback: 'high' }), 'high');
  assert.equal(pp.normalizePriorityRequest('', { fallback: 'high' }), 'high');
  // Default fallback is 'high' when unspecified.
  assert.equal(pp.normalizePriorityRequest(undefined), 'high');
});

test('normalizePriorityRequest: a non-empty invalid value returns null', () => {
  // fallback:null lets a caller distinguish "unset" (→ fallback) from
  // "provided-but-wrong" (→ null, so it can be loud).
  assert.equal(pp.normalizePriorityRequest('bogus', { fallback: null }), null);
  assert.equal(pp.normalizePriorityRequest('medium', { fallback: null }), null);
  assert.equal(pp.normalizePriorityRequest('realtimee', { fallback: null }), null);
});

test('resolvePriorityRequest: honors precedence (first non-empty valid source wins)', () => {
  const r = pp.resolvePriorityRequest([
    { value: undefined, origin: 'env' },
    { value: 'realtime', origin: 'cli' },
    { value: 'high', origin: 'config' },
  ], { logger: () => {} });
  assert.deepEqual(r, { request: 'realtime', origin: 'cli' });
});

test('resolvePriorityRequest: skips empty sources down to config', () => {
  const r = pp.resolvePriorityRequest([
    { value: undefined, origin: 'env BM26_ENGINE_PRIORITY' },
    { value: null, origin: '--engine-priority' },
    { value: 'high', origin: 'config engine.priority' },
  ], { logger: () => {} });
  assert.deepEqual(r, { request: 'high', origin: 'config engine.priority' });
});

test('resolvePriorityRequest: falls back to default with origin=default when nothing set', () => {
  const r = pp.resolvePriorityRequest([
    { value: '', origin: 'env' },
  ], { fallback: 'high', logger: () => {} });
  assert.deepEqual(r, { request: 'high', origin: 'default' });
});

test('resolvePriorityRequest: an invalid explicit value is reported LOUDLY, then skipped', () => {
  const logs = [];
  const r = pp.resolvePriorityRequest([
    { value: 'turbo', origin: 'env BM26_ENGINE_PRIORITY' },
    { value: 'realtime', origin: 'cli' },
  ], { logger: (m) => logs.push(m), label: 'EnginePriority' });
  assert.deepEqual(r, { request: 'realtime', origin: 'cli' });
  assert.ok(
    logs.some((m) => /ignoring invalid priority 'turbo'/.test(m) && /env BM26_ENGINE_PRIORITY/.test(m)),
    `expected a loud warning about the invalid value, got: ${JSON.stringify(logs)}`);
});

test('classForNice: maps the OS nice read-back to Windows class names', () => {
  assert.equal(pp.classForNice(-20), 'REALTIME');
  assert.equal(pp.classForNice(-14), 'HIGH');
  assert.equal(pp.classForNice(-7), 'ABOVE_NORMAL');
  assert.equal(pp.classForNice(0), 'NORMAL');
  assert.equal(pp.classForNice(10), 'BELOW_NORMAL');
  assert.equal(pp.classForNice(19), 'IDLE');
  // Unknown values are named explicitly, never silently mislabeled.
  assert.equal(pp.classForNice(3), 'nice(3)');
});

test('priorityLine: exact read-back log-line contract', () => {
  assert.equal(
    pp.priorityLine('EnginePriority', 'HIGH', 'HIGH'),
    '[EnginePriority] requested=HIGH achieved=HIGH');
  assert.equal(
    pp.priorityLine('BridgePriority', 'REALTIME', 'HIGH'),
    '[BridgePriority] requested=REALTIME achieved=HIGH');
  // The contract substring the launcher/log-scan depends on.
  assert.match(
    pp.priorityLine('EnginePriority', 'HIGH', 'NORMAL'),
    /^\[EnginePriority\] requested=HIGH achieved=NORMAL$/);
});

test('interpret: detects a realtime request the OS clamped to HIGH (no admin)', () => {
  assert.deepEqual(pp.interpret('REALTIME', -14), { achieved: 'HIGH', ok: false });
  assert.deepEqual(pp.interpret('REALTIME', -20), { achieved: 'REALTIME', ok: true });
  assert.deepEqual(pp.interpret('HIGH', -14), { achieved: 'HIGH', ok: true });
  // A silent no-elevation (still NORMAL) is NOT ok.
  assert.deepEqual(pp.interpret('HIGH', 0), { achieved: 'NORMAL', ok: false });
});

test('REQUESTS table exposes only the two SAFE classes with correct nice values', () => {
  const os = require('os');
  assert.deepEqual(Object.keys(pp.REQUESTS).sort(), ['high', 'realtime']);
  assert.equal(pp.REQUESTS.high.nice, os.constants.priority.PRIORITY_HIGH);
  assert.equal(pp.REQUESTS.high.className, 'HIGH');
  assert.equal(pp.REQUESTS.realtime.nice, os.constants.priority.PRIORITY_HIGHEST);
  assert.equal(pp.REQUESTS.realtime.className, 'REALTIME');
  assert.equal(pp.DEFAULT_REQUEST, 'high');
});
