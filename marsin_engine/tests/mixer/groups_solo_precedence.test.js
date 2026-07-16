// Unit tests for WAVE 15 — Channel Groups (gang-faders) + server-authoritative
// Solo precedence (PatternMixer._effFader, driven through renderAll6ch).
//
// Precedence (spec §7):
//   groupScale = group ? (muted ? 0 : fader) : 1
//   soloActive = soloedChannelIds.size > 0
//   soloGate   = !soloActive ? 1 : (soloSafe || faderLocked || soloed) ? 1 : 0
//   enabledGate= enabled ? 1 : 0
//   effFader   = clamp(fader, 0, faderMax) * groupScale * soloGate * enabledGate
//
// The fake WASM host's renderBlend6ch is a fader-weighted lerp(bg, fg), so a
// single white overlay over a black background paints round(255 * effFader)
// into pixel 0 — letting us assert the composite numerically.
//
// Run:  cd marsin_engine && node --test tests/groups_solo_precedence.test.js
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
    beginFrame() {}, setControl() {}, destroy() {},
    getExports() { return []; },
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

function whitePainter() {
  return { fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 255; } };
}

// Build a mixer with N white overlays. Returns the mixer; each overlay paints
// white. viewFader=1 → output IS the mixer composite.
function makeMixer(overlayConfigs) {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2 });
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.wantVisThisFrame = false;
  mixer.viewFader = 1.0;
  mixer.targetViewFader = 1.0;
  for (const cfg of overlayConfigs) {
    mixer.addMixerChannel({
      name: 'White', pattern: 'white', handle: whitePainter(),
      mode: 'blend_screen', fader: 1.0, enabled: true, ...cfg,
    });
  }
  return mixer;
}

// Helper: red byte of pixel 0 after one render.
function red0(mixer) { return mixer.renderAll6ch()[0]; }

test('no solo, no group: a full overlay paints at full (regression)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  assert.equal(red0(m), 255);
});

test('mute (enabled=false) WINS over solo — explicit kill is not resurrected', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, enabled: false }]);
  m.setSolo('a'); // solo a muted channel
  assert.equal(red0(m), 0, 'a muted channel stays dark even when soloed');
});

test('soloSafe survives ANOTHER channel solo (mission-critical exterior)', () => {
  const m = makeMixer([
    { id: 'ext', fader: 1.0, soloSafe: true },
    { id: 'int', fader: 1.0 },
  ]);
  m.setSolo('int'); // solo the interior
  // ext is solo-safe → stays lit. int is soloed → lit. Both white over black,
  // screen-lerp → still 255 at pixel 0.
  assert.equal(red0(m), 255, 'solo-safe exterior stays lit through an interior solo');
});

test('a NON-safe sibling is gated dark when another channel is soloed', () => {
  const m = makeMixer([
    { id: 'a', fader: 1.0 },
    { id: 'b', fader: 1.0 },
  ]);
  m.setSolo('a');
  // Only a contributes. b is gated to 0. Output still 255 (a is white).
  assert.equal(red0(m), 255);
  // Now solo b only; remove a's contribution by making it the gated one and
  // checking b alone via a half-fader so we can see the gate took effect.
  const m2 = makeMixer([{ id: 'a', fader: 0.5 }, { id: 'b', fader: 0.5 }]);
  m2.setSolo('a');
  assert.equal(red0(m2), 128, 'only soloed a (0.5) contributes; b is gated dark');
});

test('group-mute beats a member solo (structural kill wins over solo)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const g = m.createMixGroup({ name: 'G' });
  m.addChannelToGroup(g.id, 'a');
  g.muted = true;
  m.setSolo('a'); // even soloed, the group-mute kills it
  assert.equal(red0(m), 0, 'group-muted channel stays dark even when soloed');
});

test('soloSafe does NOT escape a group-mute', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, soloSafe: true }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.muted = true;
  assert.equal(red0(m), 0, 'group-mute beats solo-safe');
});

test('group fader SCALES a member (gang fader)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.fader = 0.5;
  assert.equal(red0(m), 128, 'group fader 0.5 halves the member contribution');
});

test('group fader STILL scales a soloed member (solo isolates, group attenuates)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.fader = 0.5;
  m.setSolo('a');
  assert.equal(red0(m), 128, 'soloed member is still attenuated by its group fader');
});

test('faderMax clamp is applied BEFORE the group scale', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, faderMax: 0.5 }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.fader = 0.5;
  // clamp(1.0, 0.5)=0.5, then *groupScale 0.5 = 0.25 → round(255*0.25)=64.
  assert.equal(red0(m), 64, 'faderMax (0.5) clamps own level first, then group (0.5) scales → 0.25');
});

test('fader-lock IMPLIES solo-safe — a locked channel survives another solo', () => {
  const m = makeMixer([
    { id: 'locked', fader: 1.0, faderLocked: true },
    { id: 'other', fader: 1.0 },
  ]);
  m.setSolo('other');
  assert.equal(red0(m), 255, 'fader-locked channel keeps its contribution through a solo');
});

test('group fader STILL scales a fader-locked channel (gang scale != fader write)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, faderLocked: true }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.fader = 0.5;
  assert.equal(red0(m), 128, 'a locked channel is still attenuated by its group fader');
});

test('group-mute darkens a fader-locked channel too', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, faderLocked: true }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.muted = true;
  assert.equal(red0(m), 0, 'group-mute beats fader-lock');
});

test('additive solo: two soloed members both contribute, others gated', () => {
  const m = makeMixer([
    { id: 'a', fader: 0.5 }, { id: 'b', fader: 0.5 }, { id: 'c', fader: 0.5 },
  ]);
  m.setSolo('a');
  m.setSolo('b', true); // additive
  assert.equal(m.soloedChannelIds.size, 2);
  assert.ok(m.soloedChannelIds.has('a') && m.soloedChannelIds.has('b'));
  // a and b both contribute (c is gated dark). Sequential screen-lerp over
  // black: 0 → a(0.5)=128 → b(0.5)=round(128+(255-128)*0.5)=192.
  assert.equal(red0(m), 192);
});

test('non-additive solo REPLACES the set', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  m.setSolo('a');
  m.setSolo('b'); // replace
  assert.equal(m.soloedChannelIds.size, 1);
  assert.ok(m.soloedChannelIds.has('b'));
});

test('clearing all solo restores the full mix', () => {
  const m = makeMixer([{ id: 'a', fader: 0.5 }, { id: 'b', fader: 0.5 }]);
  m.setSolo('a');
  m.clearSolo();
  assert.equal(m.soloedChannelIds.size, 0);
  // Both contribute again; screen of two 0.5 whites → 0.5+0.5*0.5... but our
  // lerp composites sequentially: bg starts 0, after a: 128, after b:
  // round(128 + (255-128)*0.5)=192.
  assert.equal(red0(m), 192);
});

test('solo with ONLY solo-safe channels leaves the mix unchanged', () => {
  const m = makeMixer([
    { id: 's1', fader: 0.5, soloSafe: true },
    { id: 's2', fader: 0.5, soloSafe: true },
  ]);
  const before = red0(m);
  m.setSolo('s1');
  const after = red0(m);
  assert.equal(after, before, 'soloing among all-safe channels does not darken anything');
});

test('master fade acts last and darkens even soloed/safe channels (different stage)', () => {
  const m = makeMixer([{ id: 'ext', fader: 1.0, soloSafe: true }, { id: 'int', fader: 1.0 }]);
  m.setSolo('int');
  m.setMaster(0.5); // grand-master fade
  // ext stays lit through solo (255), but master halves the FINAL output.
  assert.equal(red0(m), 128, 'master fade applies after solo/group, dimming everything');
});

test('_effFader is pure: repeated renders allocate no new group-scale Map', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  const cacheRef = m._groupScaleCache;
  m.renderAll6ch();
  m.renderAll6ch();
  assert.equal(m._groupScaleCache, cacheRef, 'the group-scale cache Map is reused, not reallocated');
});
