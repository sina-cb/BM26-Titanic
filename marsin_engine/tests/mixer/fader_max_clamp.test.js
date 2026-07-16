// Unit tests for the per-channel intensity clamp (F-C, faderMax).
//
// faderMax is a hard ceiling on a channel's OWN contribution to the mixer
// composite: the blend at composite time uses Math.min(channel.fader,
// faderMax). A fader (or scripted transition) can ride up to faderMax but no
// further — the clamp is the last word. Default 1.0 = no clamp.
//
// These tests drive the real PatternMixer.renderAll6ch() with a fake WASM
// host whose renderBlend6ch is a fader-weighted lerp(bg, fg), so the output
// byte for a single overlay over a black background is exactly
// round(255 * effectiveFader). That lets us assert the clamp numerically.
//
// Run:  cd marsin_engine && node --test tests/fader_max_clamp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

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

function whitePainter() {
  return {
    fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 255; },
  };
}

// A mixer with a single white overlay (no deck). viewFader=1 → output is the
// mixer composite. Output red byte for pixel 0 == round(255 * effFader).
function makeSingleOverlayMixer(overlayConfig) {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2 });
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.wantVisThisFrame = false;
  mixer.viewFader = 1.0;
  mixer.targetViewFader = 1.0;
  mixer.addMixerChannel({
    id: 'ch_clamp', name: 'White', pattern: 'white',
    handle: whitePainter(), mode: 'blend_screen', fader: 1.0, enabled: true,
    ...overlayConfig,
  });
  return mixer;
}

test('faderMax default 1.0 lets a full fader paint at full intensity', () => {
  const m = makeSingleOverlayMixer({ fader: 1.0 });
  const out = m.renderAll6ch();
  assert.equal(out[0], 255, 'fader=1, faderMax=1 → full white');
});

test('faderMax clamps a higher fader to the ceiling', () => {
  const m = makeSingleOverlayMixer({ fader: 1.0, faderMax: 0.5 });
  const out = m.renderAll6ch();
  // effFader = min(1.0, 0.5) = 0.5 → round(255 * 0.5) = 128.
  assert.equal(out[0], 128, 'fader=1.0 clamped by faderMax=0.5 → 128');
});

test('a fader BELOW faderMax is unaffected (ceiling only caps the top)', () => {
  const m = makeSingleOverlayMixer({ fader: 0.25, faderMax: 0.8 });
  const out = m.renderAll6ch();
  // effFader = min(0.25, 0.8) = 0.25 → round(255 * 0.25) = 64.
  assert.equal(out[0], 64, 'fader below ceiling passes through unclamped');
});

test('faderMax=0 fully suppresses the channel (clamped to dark, skipped)', () => {
  const m = makeSingleOverlayMixer({ fader: 1.0, faderMax: 0.0 });
  const out = m.renderAll6ch();
  assert.equal(out[0], 0, 'faderMax=0 → channel contributes nothing');
});

test('raising the fader past the ceiling never exceeds faderMax', () => {
  const m = makeSingleOverlayMixer({ fader: 0.5, faderMax: 0.5 });
  const ch = m.getMixerChannel('ch_clamp');
  // Simulate a scripted transition / manual write pushing fader to 1.0.
  ch.fader = 1.0;
  const out = m.renderAll6ch();
  assert.equal(out[0], 128, 'fader driven to 1.0 still clamped at faderMax=0.5');
});

test('a non-finite faderMax falls back to the 1.0 default (defensive)', () => {
  const m = makeSingleOverlayMixer({ fader: 1.0 });
  const ch = m.getMixerChannel('ch_clamp');
  ch.faderMax = NaN; // corrupt value sneaks in
  const out = m.renderAll6ch();
  assert.equal(out[0], 255, 'NaN faderMax defaults to no-clamp (1.0)');
});
