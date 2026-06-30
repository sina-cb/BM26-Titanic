// Unit tests for per-channel output METERING (channel metering wave).
//
// The mixer computes a cheap effective-output `level` (0..1) per channel
// every vis-broadcast frame, surfaced via PatternMixer.getVisLevels(). Each
// level is the channel's intrinsic mean brightness (mean of every RGBWAU
// byte / 255) scaled by the SAME effFader (fader / faderMax clamp / group
// scale / solo gate / enabled) that gates its contribution to the composite.
// So a fader at 0, a muted group, or a solo gate drives the meter to ~0 even
// when the underlying pattern is bright — it reports what actually reaches
// the mix, which tells the operator which layer is contributing light vs
// sitting dark.
//
// These tests drive the real PatternMixer.renderAll6ch() with a fake WASM
// host (a fader-weighted lerp blend + a fill painter), mirroring
// fader_max_clamp.test.js. Levels only populate when wantVisThisFrame is
// true (the vis pre-pass), so each test sets it.
//
// Run:  cd marsin_engine && node --test tests/channel_metering.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch(handle, buffer) {
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      for (let i = 0; i < bg.length; i++) {
        out[i] = Math.round(bg[i] + (fg[i] - bg[i]) * fader);
      }
      return out;
    },
    beginFrame() {},
    setControl() {},
    destroy() {},
    getExports() { return []; },
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

// Painter that fills every byte with `v` (0..255). v=255 → mean brightness 1.0.
function constPainter(v) {
  return { fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = v; } };
}

function makeMixer({ pixelCount = 2 } = {}) {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount });
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.wantVisThisFrame = true; // levels populate only on vis frames
  mixer.viewFader = 1.0;
  mixer.targetViewFader = 1.0;
  return mixer;
}

const APPROX = 1e-6;

test('a bright overlay at full fader reports a level near 1', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  assert.ok(Math.abs(levels['ch1'] - 1.0) < APPROX, `expected ~1.0, got ${levels['ch1']}`);
});

test('fader=0 drives the level to ~0 even though the pattern is bright', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 0.0, enabled: true,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  assert.equal(levels['ch1'], 0, `fader 0 → level 0, got ${levels['ch1']}`);
});

test('level scales linearly with the fader (post-fader contribution)', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 0.5, enabled: true,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  // mean brightness 1.0 * effFader 0.5 = 0.5
  assert.ok(Math.abs(levels['ch1'] - 0.5) < APPROX, `expected ~0.5, got ${levels['ch1']}`);
});

test('a half-bright pattern at full fader reports half level', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'gray', handle: constPainter(128),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  // mean brightness 128/255 ≈ 0.50196, effFader 1.0
  assert.ok(Math.abs(levels['ch1'] - (128 / 255)) < APPROX, `got ${levels['ch1']}`);
});

test('faderMax clamp caps the reported level', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, faderMax: 0.25, enabled: true,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  assert.ok(Math.abs(levels['ch1'] - 0.25) < APPROX, `clamped to faderMax → ~0.25, got ${levels['ch1']}`);
});

test('a disabled channel reports level 0', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: false,
  });
  m.renderAll6ch();
  const levels = m.getVisLevels();
  assert.equal(levels['ch1'], 0, 'disabled → 0');
});

test('a non-soloed channel is gated to 0 while another channel is soloed', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'soloed', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.addMixerChannel({
    id: 'other', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.setSolo('soloed');
  m.renderAll6ch();
  const levels = m.getVisLevels();
  assert.ok(Math.abs(levels['soloed'] - 1.0) < APPROX, `soloed stays lit, got ${levels['soloed']}`);
  assert.equal(levels['other'], 0, 'non-soloed gated to 0');
});

test('a muted group scales every member level to 0', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  const g = m.createMixGroup({ name: 'grp' });
  m.addChannelToGroup(g.id, 'ch1');
  m.updateMixGroup(g.id, { muted: true });
  m.renderAll6ch();
  assert.equal(m.getVisLevels()['ch1'], 0, 'muted group → member level 0');
  // Un-mute restores it.
  m.updateMixGroup(g.id, { muted: false });
  m.renderAll6ch();
  assert.ok(Math.abs(m.getVisLevels()['ch1'] - 1.0) < APPROX, 'un-muted group restores level');
});

test('a group fader scales the member level proportionally', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  const g = m.createMixGroup({ name: 'grp' });
  m.addChannelToGroup(g.id, 'ch1');
  m.updateMixGroup(g.id, { fader: 0.5 });
  m.renderAll6ch();
  assert.ok(Math.abs(m.getVisLevels()['ch1'] - 0.5) < APPROX, `group fader scales level, got ${m.getVisLevels()['ch1']}`);
});

test('the deck channel meters its own clamped fader (PFL, no group/solo)', () => {
  const m = makeMixer();
  m.setDeckChannel({
    id: 'deck', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 0.5, enabled: true,
  });
  m.renderAll6ch();
  // Deck level = intrinsic brightness 1.0 * its own fader 0.5.
  assert.ok(Math.abs(m.getVisLevels()['deck'] - 0.5) < APPROX, `deck level, got ${m.getVisLevels()['deck']}`);
});

test('master level reflects the final composed output brightness', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.renderAll6ch();
  // Single full-white overlay over black, viewFader=1, master=1 → output 255.
  assert.ok(Math.abs(m.getVisLevels()['master'] - 1.0) < APPROX, `master, got ${m.getVisLevels()['master']}`);
});

test('levels are NOT populated on non-vis frames (no wasted work)', () => {
  const m = makeMixer();
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.wantVisThisFrame = false;
  m.renderAll6ch();
  // _visLevels keeps its prior (empty) contents — no key written this frame.
  assert.equal(m.getVisLevels()['ch1'], undefined, 'non-vis frame skips level computation');
});

test('getVisLevels returns the SAME keys as getVisData', () => {
  const m = makeMixer();
  m.setDeckChannel({
    id: 'deck', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.addMixerChannel({
    id: 'ch1', pattern: 'white', handle: constPainter(255),
    mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  m.renderAll6ch();
  const visKeys = Object.keys(m.getVisData()).sort();
  const levelKeys = Object.keys(m.getVisLevels()).sort();
  assert.deepEqual(levelKeys, visKeys, 'level keys match vis keys');
});
