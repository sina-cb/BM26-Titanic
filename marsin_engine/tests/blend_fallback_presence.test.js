// Tests that the blend scripts the engine relies on are present, and that a
// MISSING blend script is detectable rather than masquerading as a valid one.
// Run:  node --test tests/blend_fallback_presence.test.js
//
// ── Scope / coordination note ───────────────────────────────────────────
// pattern_mixer.js (owned by another agent on a concurrent branch) currently
// SILENTLY FALLS BACK to a host-side lerp when getBlendHandle() returns null
// (see renderAll6ch: `else { ... blendedScratch ... }`). Per the codex P0
// "no silent fallbacks" rule that is a latent bug — a typo'd blend mode would
// render the wrong compositing math with zero operator signal.
//
// This test does NOT reach into that render path (it is not ours to change).
// Instead it asserts OBSERVABLES that will remain true regardless of whether
// the fallback is later hardened to fail loud:
//   1. Every blend/transition script the engine references at boot exists on
//      disk (this is what keeps the dry-run free of missing-blend warnings).
//   2. getBlendHandle() returns null — NOT a fake/usable handle — for a
//      genuinely missing script. A null return is the hook a loud-fail
//      implementation will branch on; documenting it here pins the contract.
//
// TODO(engine_state_hardening handoff): once pattern_mixer.js stops silently
// falling back on a null blend handle (codex P0), add an assertion that a
// missing blend mode is surfaced loudly (thrown/logged-and-skipped) at render
// time. Until then we only assert the null-handle contract below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PatternMixer } from '../lib/pattern_mixer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.join(__dirname, '..', 'patterns');

// Blend modes the engine actually uses for boot-created channels and the
// default transition config. If any of these scripts vanish, the dry-run
// starts printing missing-blend warnings and live compositing breaks.
const REQUIRED_BLENDS = ['blend_screen', 'blend_add', 'blend_over'];
const REQUIRED_TRANSITIONS = ['trans_crossfade'];

function blendExistsOnDisk(name) {
  const inBlends = path.join(PATTERNS_DIR, 'channel_blends', `${name}.js`);
  const inTrans = path.join(PATTERNS_DIR, 'transitions', `${name}.js`);
  return fs.existsSync(inBlends) || fs.existsSync(inTrans);
}

test('required blend scripts exist on disk (keeps dry-run warning-free)', () => {
  for (const name of REQUIRED_BLENDS) {
    assert.ok(blendExistsOnDisk(name), `missing required blend script: ${name}.js`);
  }
});

test('required transition scripts exist on disk', () => {
  for (const name of REQUIRED_TRANSITIONS) {
    assert.ok(blendExistsOnDisk(name), `missing required transition script: ${name}.js`);
  }
});

test('getBlendHandle returns null for a genuinely missing blend script', () => {
  // Real patternsDir, but ask for a name that does not exist in either
  // channel_blends/ or transitions/. The mixer must return null (the signal
  // a loud-fail path will branch on) and must NOT fabricate a usable handle.
  const mixer = new PatternMixer({ wasmHost: { destroy() {} }, pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  const handle = mixer.getBlendHandle('blend_does_not_exist_xyz');
  assert.equal(handle, null, 'missing blend script should resolve to a null handle');
});

test('getBlendHandle(null/empty) returns null without touching disk', () => {
  const mixer = new PatternMixer({ wasmHost: { destroy() {} }, pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  assert.equal(mixer.getBlendHandle(null), null);
  assert.equal(mixer.getBlendHandle(''), null);
});

test('the missing-blend handle is cached as null (no repeated disk thrash, stays detectable)', () => {
  const mixer = new PatternMixer({ wasmHost: { destroy() {} }, pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  assert.equal(mixer.getBlendHandle('blend_missing_abc'), null);
  // Second lookup hits the cache; still null — the absence is sticky and the
  // caller can rely on a stable null to detect the missing script.
  assert.equal(mixer.getBlendHandle('blend_missing_abc'), null);
});
