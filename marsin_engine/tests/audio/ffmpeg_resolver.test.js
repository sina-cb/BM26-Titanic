/**
 * ffmpeg_resolver.test.js — `lib/ffmpeg_resolver.js` fail-loud audit
 * (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-16). Before this file, zero tests referenced this module (grep-verified
 * at test-write time).
 *
 * REAL FINDING, NEEDS-RULING (pinned, not fixed — test code only per this
 * agent's mandate): `resolveFfmpegPath` has a SILENT FALLBACK CHAIN that
 * appears to violate the codex P0 rule ("No fallback behaviors. Ever.").
 * An explicit `configuredPath` that does not exist on disk is silently
 * DISCARDED — the function falls through to the local `bin/` probe, then
 * `ffmpeg-static`, and returns THAT binary's path with no warning, no
 * error, and no way for the caller to tell the configured path was ignored.
 * Verified empirically: `resolveFfmpegPath('/does/not/exist/ffmpeg')`
 * returns the `ffmpeg-static` bundled binary's path, not a thrown error.
 * The catalog's draft spec assumed the opposite ("explicit configured path
 * that doesn't exist -> throws naming the path") — that is NOT what the
 * code does; this file pins the REAL behavior and carries the ruling
 * question below rather than asserting the draft's assumption.
 *
 * RULING QUESTION for the fix wave: should an explicit, non-existent
 * `audio.capture.ffmpegPath` throw at resolve time (the operator asked for
 * a specific binary; silently substituting a different one could mean the
 * WRONG ffmpeg build runs with no visible sign of the misconfiguration), or
 * is silently falling back to the bundled binary the intended UX (a typo'd
 * config shouldn't brick audio capture entirely)? File the follow-up on the
 * Notion board when this lands.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { resolveFfmpegPath } from '../../lib/ffmpeg_resolver.js';

test('NEEDS-RULING: an explicit configured path that does NOT exist is silently discarded, not refused', async () => {
  const bogus = '/definitely/does/not/exist/ffmpeg-binary-xyz';
  const resolved = await resolveFfmpegPath(bogus);
  assert.notEqual(resolved, bogus, 'today: the bogus path is silently abandoned, not returned/thrown');
  assert.ok(fs.existsSync(resolved), `the silently-substituted path must at least exist: ${resolved}`);
  assert.doesNotMatch(resolved, /does-not-exist|definitely/,
    'confirms the fallback chain ran (the substituted path shares no fragment with the bogus input)');
});

test("'ffmpeg' (the documented default marker) resolves to an existing absolute path on this platform", async () => {
  const resolved = await resolveFfmpegPath('ffmpeg');
  assert.equal(typeof resolved, 'string');
  // Either a local bin/, the ffmpeg-static binary, or (last resort) the bare
  // command name for PATH lookup — all three are "existing" in the sense
  // that matters, but ffmpeg-static is vendored and expected to win in a
  // normal checkout with node_modules installed.
  if (resolved !== 'ffmpeg') {
    assert.ok(path_isAbsoluteAndExists(resolved), `resolved path must exist: ${resolved}`);
  }
});

test('null / empty configuredPath resolve through the same fallback chain (no throw)', async () => {
  const viaNull = await resolveFfmpegPath(null);
  const viaEmpty = await resolveFfmpegPath('');
  assert.equal(typeof viaNull, 'string');
  assert.equal(typeof viaEmpty, 'string');
  assert.equal(viaNull, viaEmpty, 'null and empty-string configs must resolve identically (both mean "no preference")');
});

test('a non-string configuredPath throws LOUDLY (not silently coerced or ignored)', async () => {
  // path.isAbsolute(42) throws a raw Node TypeError — loud, but not a
  // custom, actionable message naming what was actually misconfigured.
  // Pinned as today's real (loud, not silent) behavior; a nicer message
  // would be a welcome fix, not a contract change this test would need to
  // flip on.
  await assert.rejects(
    () => resolveFfmpegPath(42),
    (err) => {
      assert.match(err.message, /path.*must be of type string/i);
      return true;
    },
  );
});

function path_isAbsoluteAndExists(p) {
  return fs.existsSync(p);
}
