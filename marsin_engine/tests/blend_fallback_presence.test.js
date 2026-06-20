// Tests that the blend scripts the engine relies on are present, and that a
// MISSING blend script is surfaced LOUDLY (codex P0 — no silent fallback)
// rather than masquerading as a valid handle.
//
// Run:  node --test tests/blend_fallback_presence.test.js
//
// ── History ─────────────────────────────────────────────────────────────
// This file was authored on dev/engine_state_hardening to pin the null-handle
// contract while pattern_mixer.js (owned by dev/engine_hotswap_mixer) still
// SILENTLY fell back to a host-side lerp on a null blend handle. That fix has
// now landed: setting `mixer.patternsDir` precompiles every blend at boot, and
// a missing/failed blend is recorded in `renderHealth` (exposed on /status as
// `renderHealth.ok === false`) and logged loudly ONCE per mode. The original
// TODO ("assert the loud-fail path once the fix lands") is fulfilled below.
//
// Because the precompile now runs on the `patternsDir` setter, the wasmHost
// stub must implement `compile()` — a minimal `{ destroy() {} }` is no longer
// enough.
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

// A wasmHost stub that "compiles" any real source to an opaque non-null handle.
// The precompile path reads the real .js files off disk, so existing blend
// scripts resolve to a (fake) handle; only genuinely missing scripts return
// null. We never need a real VM here — we only assert handle presence/absence
// and the render-health bookkeeping around it.
function makeWasmHostStub() {
  return {
    compile() { return { ok: true, handle: { __fakeBlend: true } }; },
    destroy() {},
  };
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
  // channel_blends/ or transitions/. The mixer must return null (NOT a
  // fabricated handle) so a loud-fail path can branch on the absence.
  const mixer = new PatternMixer({ wasmHost: makeWasmHostStub(), pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  const handle = mixer.getBlendHandle('blend_does_not_exist_xyz');
  assert.equal(handle, null, 'missing blend script should resolve to a null handle');
});

test('getBlendHandle(null/empty) returns null without touching disk', () => {
  const mixer = new PatternMixer({ wasmHost: makeWasmHostStub(), pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  assert.equal(mixer.getBlendHandle(null), null);
  assert.equal(mixer.getBlendHandle(''), null);
});

test('the missing-blend handle is cached as null (no repeated disk thrash, stays detectable)', () => {
  const mixer = new PatternMixer({ wasmHost: makeWasmHostStub(), pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;
  assert.equal(mixer.getBlendHandle('blend_missing_abc'), null);
  // Second lookup hits the cache; still null — the absence is sticky and the
  // caller can rely on a stable null to detect the missing script.
  assert.equal(mixer.getBlendHandle('blend_missing_abc'), null);
});

// ── The loud-fail assertion the original TODO asked for (now landed) ───────
test('a missing blend mode is surfaced LOUDLY via renderHealth, not silently', () => {
  const mixer = new PatternMixer({ wasmHost: makeWasmHostStub(), pixelCount: 4, maxChannels: 4 });
  mixer.patternsDir = PATTERNS_DIR;

  // After boot precompile of the real scripts, render-health is clean.
  assert.equal(mixer.getRenderHealth().ok, true, 'real blends should leave renderHealth ok');

  // Requesting a missing mode records a VISIBLE render-health error (the hook
  // /status reports as renderHealth.ok === false) instead of silently lerping.
  assert.equal(mixer.getBlendHandle('blend_totally_absent'), null);
  const health = mixer.getRenderHealth();
  assert.equal(health.ok, false, 'a missing blend must flip renderHealth.ok to false');
  const names = health.blendErrors.map(e => e.blend);
  assert.ok(
    names.includes('blend_totally_absent'),
    `renderHealth.blendErrors should name the missing mode; got ${JSON.stringify(names)}`,
  );
});
