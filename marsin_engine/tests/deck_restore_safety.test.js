// Unit tests for FIX A — mission-critical deck-restore safety.
// Run:  node --test tests/deck_restore_safety.test.js
//
// The deck channel drives the Titanic's exterior — the ONE surface that is
// mission-critical to be visible at night. Restoring it from saved state must
// NEVER boot the rig dark. These tests pin the keep-lit fallback contract of
// `restoreDeckWithFallback`:
//
//   (1) a saved deck with pattern=null falls back to the DEFAULT pattern (the
//       deck is built, NOT null) and reports a degraded descriptor;
//   (2) a saved deck pointing at a MISSING pattern name does the same;
//   (3) a VALID saved deck restores normally with NO degraded flag;
//   (+) if the DEFAULT pattern ALSO fails, boot throws fatally (the install is
//       broken) — a dark deck is never silently accepted.
//
// The injected `build(pattern)` callback stands in for the engine's real
// load+compile+install path: it THROWS for null/empty/missing patterns and for
// a pattern that "fails to compile", and returns a fake channel otherwise —
// exactly the failure surface restoreChannel hands the helper at boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { restoreDeckWithFallback } from '../lib/api_server.js';

const DEFAULT_PATTERN = 'test_const';

// Patterns the fake install "has" and that compile cleanly.
const VALID_PATTERNS = new Set([DEFAULT_PATTERN, 'good_saved_pattern']);
// A pattern that exists but fails to compile (the second bad deck outcome).
const COMPILE_FAILS = new Set(['compiles_bad']);

// Build callback mirroring buildChannelFromSaved's throw surface: it throws on
// a missing-file / null name and on a compile failure, else returns a channel.
function makeBuild(record) {
  return (pattern) => {
    record.attempts.push(pattern);
    if (pattern == null || pattern === '') {
      throw new Error(`Pattern not found: ${pattern}.js`);
    }
    if (COMPILE_FAILS.has(pattern)) {
      throw new Error(`Failed to compile saved deck channel '${pattern}': syntax error`);
    }
    if (!VALID_PATTERNS.has(pattern)) {
      throw new Error(`Pattern not found: ${pattern}.js`);
    }
    return { id: 'ch_base', pattern, handle: { fake: true } };
  };
}

test('FIX A (1): saved deck pattern=null falls back to default, deck NOT null, degraded set', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: null };
  const { channel, degraded } = restoreDeckWithFallback(saved, DEFAULT_PATTERN, makeBuild(record));

  // Deck is LIT — built from the default, never null.
  assert.ok(channel, 'deck channel must not be null on a null saved pattern');
  assert.equal(channel.pattern, DEFAULT_PATTERN, 'deck must fall back to the default pattern');
  // Loud + visible degrade descriptor.
  assert.ok(degraded, 'degraded descriptor must be set');
  assert.equal(degraded.failedPattern, null);
  assert.equal(degraded.fellBackTo, DEFAULT_PATTERN);
  assert.match(degraded.reason, /null|empty/i);
  // It tried the default to build the keep-lit deck.
  assert.ok(record.attempts.includes(DEFAULT_PATTERN));
});

test('FIX A (1b): saved deck pattern="" (empty) also falls back to default with degraded set', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: '' };
  const { channel, degraded } = restoreDeckWithFallback(saved, DEFAULT_PATTERN, makeBuild(record));
  assert.ok(channel, 'deck channel must not be null on an empty saved pattern');
  assert.equal(channel.pattern, DEFAULT_PATTERN);
  assert.ok(degraded);
  assert.equal(degraded.fellBackTo, DEFAULT_PATTERN);
});

test('FIX A (2): saved deck pointing at a MISSING pattern falls back to default with degraded set', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: 'does_not_exist' };
  const { channel, degraded } = restoreDeckWithFallback(saved, DEFAULT_PATTERN, makeBuild(record));

  assert.ok(channel, 'deck channel must not be null on a missing saved pattern');
  assert.equal(channel.pattern, DEFAULT_PATTERN, 'deck must fall back to the default pattern');
  assert.ok(degraded, 'degraded descriptor must be set');
  assert.equal(degraded.failedPattern, 'does_not_exist');
  assert.equal(degraded.fellBackTo, DEFAULT_PATTERN);
  assert.match(degraded.reason, /not found/i);
  // It attempted the saved pattern first, then the default.
  assert.deepEqual(record.attempts, ['does_not_exist', DEFAULT_PATTERN]);
});

test('FIX A (2b): saved deck pattern that COMPILES BAD falls back to default with degraded set', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: 'compiles_bad' };
  const { channel, degraded } = restoreDeckWithFallback(saved, DEFAULT_PATTERN, makeBuild(record));

  assert.ok(channel, 'deck channel must not be null on a compile failure');
  assert.equal(channel.pattern, DEFAULT_PATTERN);
  assert.ok(degraded);
  assert.equal(degraded.failedPattern, 'compiles_bad');
  assert.equal(degraded.fellBackTo, DEFAULT_PATTERN);
  assert.match(degraded.reason, /compile/i);
});

test('FIX A (3): a VALID saved deck restores normally with NO degraded flag', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: 'good_saved_pattern' };
  const { channel, degraded } = restoreDeckWithFallback(saved, DEFAULT_PATTERN, makeBuild(record));

  assert.ok(channel, 'valid saved deck must build');
  assert.equal(channel.pattern, 'good_saved_pattern', 'must use the saved pattern, not the default');
  assert.equal(degraded, null, 'no degrade on a clean restore');
  // Built directly from the saved pattern — the default was never touched.
  assert.deepEqual(record.attempts, ['good_saved_pattern']);
});

test('FIX A (fatal): when the DEFAULT pattern ALSO fails, boot throws fatally (no silent dark deck)', () => {
  const record = { attempts: [] };
  const saved = { id: 'ch_base', name: 'Base', pattern: 'does_not_exist' };
  // Default also missing → both fail → must throw, tagged fatal so boot crashes.
  assert.throws(
    () => restoreDeckWithFallback(saved, 'also_missing_default', makeBuild(record)),
    (e) => {
      assert.equal(e._deckRestoreFatal, true, 'fatal flag must be set so boot propagates the throw');
      assert.match(e.message, /default pattern 'also_missing_default' also/i);
      return true;
    },
  );
  // It tried the saved pattern then the (also-broken) default before giving up.
  assert.deepEqual(record.attempts, ['does_not_exist', 'also_missing_default']);
});
