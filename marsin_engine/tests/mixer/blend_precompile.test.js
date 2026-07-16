// Blend precompile-at-boot + render-health visibility (Codex P0).
//
// Two behaviors are pinned here:
//
//   1. Setting mixer.patternsDir precompiles EVERY blend/transition script
//      once (boot warm-up), so the 40 Hz hot path never lazy-compiles.
//
//   2. A blend that is missing or fails to compile must FAIL LOUDLY: it is
//      recorded in render-health (getRenderHealth().ok === false, with the
//      offending mode listed) instead of silently caching null and quietly
//      falling through to host-side linear interpolation. A successful
//      (re)compile clears the health error.
//
// Run:  node --test tests/blend_precompile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { PatternMixer } from '../../lib/pattern_mixer.js';

// Fake host whose compile() succeeds for everything EXCEPT scripts whose
// source contains the marker `// FAIL_COMPILE` — letting a test stage a
// deliberately-broken blend to exercise the render-health path.
function makeFakeWasmHost() {
  return {
    renderAll6ch(handle, buffer) {
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      for (let i = 0; i < bg.length; i++) out[i] = Math.round(bg[i] + (fg[i] - bg[i]) * fader);
      return out;
    },
    beginFrame() {},
    setControl() {},
    destroy() {},
    getExports() { return []; },
    setCoords() {},
    setPixelMeta() {},
    compile(code) {
      if (typeof code === 'string' && code.includes('// FAIL_COMPILE')) {
        return { ok: false, error: 'staged compile failure' };
      }
      return { ok: true, handle: { fillFn: () => {} } };
    },
  };
}

function tmpPatternsDir({ goodBlends = ['blend_screen', 'blend_add'], transitions = ['trans_crossfade'], badBlends = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blend_precompile_'));
  const cb = path.join(root, 'channel_blends');
  const tr = path.join(root, 'transitions');
  fs.mkdirSync(cb, { recursive: true });
  fs.mkdirSync(tr, { recursive: true });
  for (const b of goodBlends) fs.writeFileSync(path.join(cb, `${b}.js`), `export var x = 0;\n`);
  for (const b of badBlends) fs.writeFileSync(path.join(cb, `${b}.js`), `// FAIL_COMPILE\nexport var x = 0;\n`);
  for (const t of transitions) fs.writeFileSync(path.join(tr, `${t}.js`), `export var x = 0;\n`);
  return root;
}

function quiet(fn) {
  const e = console.error, w = console.warn, l = console.log;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return fn(); } finally { console.error = e; console.warn = w; console.log = l; }
}

test('setting patternsDir precompiles all blends into the handle map', () => {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3 });
  const dir = tmpPatternsDir();
  quiet(() => { mixer.patternsDir = dir; });
  // Every script on disk should now have a cached, non-null handle.
  assert.ok(mixer.blendHandles['blend_screen']);
  assert.ok(mixer.blendHandles['blend_add']);
  assert.ok(mixer.blendHandles['trans_crossfade']);
  // And render-health is green.
  const h = mixer.getRenderHealth();
  assert.equal(h.ok, true);
  assert.equal(h.blendErrors.length, 0);
});

test('a blend that fails to compile is recorded in render-health (FAIL LOUD)', () => {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3 });
  const dir = tmpPatternsDir({ goodBlends: ['blend_screen'], badBlends: ['blend_broken'] });
  quiet(() => { mixer.patternsDir = dir; });
  const h = mixer.getRenderHealth();
  assert.equal(h.ok, false, 'render-health must be degraded');
  const names = h.blendErrors.map(e => e.blend);
  assert.ok(names.includes('blend_broken'), `expected blend_broken in ${JSON.stringify(names)}`);
  // The good one is still cached and usable.
  assert.ok(mixer.blendHandles['blend_screen']);
  assert.equal(mixer.blendHandles['blend_broken'], null);
});

test('getBlendHandle for a missing mode records a render-health error', () => {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3 });
  const dir = tmpPatternsDir();
  quiet(() => { mixer.patternsDir = dir; });
  // Request a mode that has no script on disk.
  const handle = quiet(() => mixer.getBlendHandle('blend_does_not_exist'));
  assert.equal(handle, null);
  const h = mixer.getRenderHealth();
  assert.equal(h.ok, false);
  assert.ok(h.blendErrors.some(e => e.blend === 'blend_does_not_exist'));
});

test('a successful (re)compile CLEARS a prior render-health error', () => {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3 });
  const dir = tmpPatternsDir({ goodBlends: ['blend_screen'], badBlends: ['blend_fixme'] });
  quiet(() => { mixer.patternsDir = dir; });
  assert.equal(mixer.getRenderHealth().ok, false);
  // Heal the file on disk and re-warm.
  fs.writeFileSync(path.join(dir, 'channel_blends', 'blend_fixme.js'), `export var x = 0;\n`);
  quiet(() => { mixer.precompileBlend('blend_fixme'); });
  const h = mixer.getRenderHealth();
  assert.equal(h.ok, true, 'health should be green after the fix');
  assert.ok(mixer.blendHandles['blend_fixme']);
});

test('render hot-path records health when a channel uses an uncompiled mode', () => {
  const wasmHost = makeFakeWasmHost();
  const pixels = [{ i: 0 }, { i: 1 }];
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3, pixels });
  const dir = tmpPatternsDir();
  quiet(() => { mixer.patternsDir = dir; });
  // Deck + a mixer overlay whose mode has no compiled handle.
  const painter = { fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 100; } };
  mixer.setDeckChannel({ id: 'd', name: 'D', pattern: 'p', handle: painter, mode: 'blend_screen', fader: 1.0, enabled: true });
  mixer.addMixerChannel({ id: 'o', name: 'O', pattern: 'p', handle: painter, mode: 'mode_with_no_script', fader: 1.0, enabled: true });
  // Render once — should NOT throw, but should record the degraded mode.
  quiet(() => { mixer.renderAll6ch(); });
  const h = mixer.getRenderHealth();
  assert.equal(h.ok, false);
  assert.ok(h.blendErrors.some(e => e.blend === 'mode_with_no_script'));
});
