/**
 * bench_mirror_reverse.test.js — the per-slot REVERSE PIXELS toggle
 * (design report 20260806_174 §3.5 + §4), end to end through the pure resolver.
 *
 * WHAT THIS IS FOR, PHYSICALLY. Two scenes can each be individually correct and
 * still disagree about which way round their fixtures are wired. That is the
 * observed case on this rig today, and the LIVE tier below proves it from the
 * REAL generated engine models rather than from anyone's memory: `test_bench`
 * Bar Left runs toward DECREASING x as `localIndex` climbs, while `titanic`
 * Left Front Wall 1 runs toward INCREASING x. Mirror one onto the other NORMAL
 * and the bench plays the ship's sweep backwards; REVERSED and it aligns.
 *
 * WHAT MUST NEVER HAPPEN, and is asserted here:
 *   - the reversal must not touch the fixture's CONTROL channels (master dimmer,
 *     strobe, macros). A footprint-wide byte reversal would put pixel data in
 *     them — "random colours with a green log", the exact failure this whole
 *     subsystem exists to prevent.
 *   - the reversal must not permute channels INSIDE a pixel. w and a swapping
 *     places is a colour bug that looks like a broken fixture.
 *   - a longer LED source must keep its FIRST-N window and reverse THOSE — never
 *     silently slide to the last N, which would show a different part of the rope.
 *   - a single-pixel fixture (every par) must REFUSE the flag by name rather than
 *     quietly treating it as identity.
 *   - the NORMAL path must be byte-for-byte what it was before this feature
 *     existed.
 *
 * ZERO PORTS, ZERO PACKETS: pure computation over parsed YAML and the committed
 * generated models. Nothing here writes a file or constructs a socket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseBenchMirrorSpec, createMirrorState, spliceMirrorFrame,
  mirrorPayload } = require('../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry, computeSlices, reversedDmxChannelMap,
  reverseApplicability, destPixelCount, validateDefinitionPixels,
  REFUSALS } = require('../lib/bench_mirror_resolve.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.join(SIM_ROOT, '..');
const LIVE_REGISTRY = loadFixtureRegistry(path.join(SIM_ROOT, 'dmx', 'fixtures'));

function liveScene(name) {
  const dir = path.join(SIM_ROOT, 'scenes', name);
  return {
    controllers: yaml.load(fs.readFileSync(path.join(dir, 'controllers.yaml'), 'utf8')),
    patches: yaml.load(fs.readFileSync(path.join(dir, 'patches.yaml'), 'utf8')),
    sceneConfig: yaml.load(fs.readFileSync(path.join(dir, 'scene_config.yaml'), 'utf8')),
  };
}

const LIVE_SPEC = parseBenchMirrorSpec(yaml.load(fs.readFileSync(
  path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml'), 'utf8')), 'live');

/**
 * Resolve the committed sidecar with its own defaults, flipping exactly the
 * slots named in `reversed` to REVERSED. Everything else is NORMAL, so each test
 * below changes ONE thing.
 */
function resolveLive(reversed = {}) {
  const selection = Object.fromEntries(LIVE_SPEC.slots.map(s => [s.slot, {
    source: s.defaultSource,
    reverse: reversed[s.slot] === true,
  }]));
  return resolveBenchMirror({
    spec: LIVE_SPEC,
    benchSceneName: 'test_bench',
    benchScene: liveScene('test_bench'),
    sourceSceneName: 'titanic',
    sourceScene: liveScene('titanic'),
    registry: LIVE_REGISTRY,
    selection,
  });
}

/** Every (destUniverse, destChannel) → (sourceUniverse, sourceChannel) pair. */
function channelMapOf(resolution) {
  const map = new Map();
  for (const m of resolution.spec.mirrors) {
    for (const s of m.slices) {
      for (let i = 0; i < s.length; i += 1) {
        map.set(`${m.destUniverse}/${s.destAddr + i}`,
          `${s.sourceUniverse}/${s.sourceAddr + i}`);
      }
    }
  }
  return map;
}

// ── The generated engine models: the PHYSICAL ground truth ─────────────────
//
// Read from the committed `marsin_engine/models/*.js` rather than re-derived
// here: the claim under test is about the real rig, and a second derivation
// would only prove this file agrees with itself.

const modelCache = new Map();
async function modelPixels(scene) {
  if (!modelCache.has(scene)) {
    const url = new URL(`file://${path.join(REPO_ROOT, 'marsin_engine', 'models', `${scene}.js`)
      .replace(/\\/g, '/')}`);
    const mod = await import(url.href);
    modelCache.set(scene, mod.pixels);
  }
  return modelCache.get(scene);
}

/** One fixture's model pixels, in `localIndex` order, with absolute channels. */
async function fixturePixels(scene, fixtureName) {
  const all = await modelPixels(scene);
  const mine = all.filter(p => typeof p.name === 'string'
    && p.name.startsWith(`${fixtureName} - `) && p.patch);
  assert.ok(mine.length > 0, `the ${scene} model must carry '${fixtureName}'`);
  mine.sort((a, b) => a.localIndex - b.localIndex);
  return mine.map(p => ({
    localIndex: p.localIndex,
    x: p.x,
    universe: p.patch.universe,
    // Model `channels` are offsets within the fixture's footprint, exactly like
    // the definition's; absolute = start address + offset - 1.
    abs: Object.fromEntries(Object.entries(p.channels)
      .map(([role, ch]) => [role, p.patch.addr + ch - 1])),
  }));
}

const strictlyIncreasing = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);
const strictlyDecreasing = (xs) => xs.every((v, i) => i === 0 || v < xs[i - 1]);

// ── 1. The fixture registry now carries per-pixel channel maps ─────────────

test('_176 §3.5: the live registry parses per-pixel channel maps for every real type', () => {
  assert.equal(LIVE_REGISTRY.get('ShehdsBar').pixels.length, 18);
  assert.equal(LIVE_REGISTRY.get('VintageLed').pixels.length, 6);
  assert.equal(LIVE_REGISTRY.get('UkingPar').pixels.length, 1);
  assert.equal(LIVE_REGISTRY.get('ShehdsBar').pixelsRefusal, null);
  // The bar's first and last pixels, straight out of the definition.
  assert.deepEqual(LIVE_REGISTRY.get('ShehdsBar').pixels[0].channels,
    { red: 12, green: 13, blue: 14, white: 15, amber: 16, violet: 17 });
  assert.deepEqual(LIVE_REGISTRY.get('ShehdsBar').pixels[17].channels,
    { red: 114, green: 115, blue: 116, white: 117, amber: 118, violet: 119 });
  // Vintage's per-head lanes are NON-CONTIGUOUS — the case a naive offset
  // reversal gets wrong.
  assert.deepEqual(LIVE_REGISTRY.get('VintageLed').pixels[0].channels,
    { value: 3, red: 16, green: 17, blue: 18 });
  assert.deepEqual(LIVE_REGISTRY.get('VintageLed').pixels[5].channels,
    { value: 8, red: 31, green: 32, blue: 33 });
  // A fog machine has no pixels at all: valid, and simply not reversible.
  assert.deepEqual(LIVE_REGISTRY.get('TEFogMachine').pixels, []);
});

test('_176 §3.5: a definition that cannot be PROVEN permutable yields pixels:null, named', () => {
  const cases = [
    ['roles differ', { pixels: [
      { id: 'a', channels: { red: 1, green: 2 } },
      { id: 'b', channels: { red: 3, blue: 4 } }] }, /must carry the same role set/],
    ['channel out of footprint', { pixels: [{ id: 'a', channels: { red: 99 } }] },
      /outside 1\.\.10/],
    ['channel claimed twice', { pixels: [
      { id: 'a', channels: { red: 1 } },
      { id: 'b', channels: { red: 1 } }] }, /claimed by both/],
    ['no channels block', { pixels: [{ id: 'a' }] }, /declares no `channels:` mapping/],
    ['no pixels list', {}, /declares no `pixels:` list/],
  ];
  for (const [what, model, re] of cases) {
    const v = validateDefinitionPixels(model, 10, 'family/model_10.yaml');
    assert.equal(v.pixels, null, what);
    assert.match(v.why, re, what);
  }
  // …and an unprovable definition refuses REVERSE by name, quoting the file,
  // while leaving the NORMAL path entirely alone.
  const verdict = reverseApplicability({ kind: 'dmx', name: 'X', fixtureType: 'Weird',
    defPixels: null, defPixelsRefusal: 'channel 3 is claimed by both pixels[0] and pixels[1]',
    defFile: 'weird/model_9.yaml' });
  assert.equal(verdict.applicable, false);
  assert.equal(verdict.unprovable, true);
  assert.match(verdict.why, /weird\/model_9\.yaml/);
  assert.match(verdict.why, /claimed by both/);
});

// ── 2. The permutation itself, at channel level ────────────────────────────

test('_176 §3.5: the reversed ShehdsBar map permutes pixels and IDENTITY-copies controls', () => {
  const dest = { kind: 'dmx', name: 'Bar Left', fixtureType: 'ShehdsBar', footprintCh: 119,
    defPixels: LIVE_REGISTRY.get('ShehdsBar').pixels };
  const map = reversedDmxChannelMap(dest);
  // Controls 1-11 are claimed by no pixel → identity.
  for (let c = 1; c <= 11; c += 1) {
    assert.equal(map[c], c, `control channel ${c} must be identity-copied, never permuted`);
  }
  // Pixel 1 (12-17) is fed by pixel 18 (114-119), ROLE FOR ROLE.
  assert.deepEqual([12, 13, 14, 15, 16, 17].map(c => map[c]), [114, 115, 116, 117, 118, 119]);
  assert.deepEqual([114, 115, 116, 117, 118, 119].map(c => map[c]), [12, 13, 14, 15, 16, 17],
    'the permutation is an involution');
  // The whole map is a bijection over 1..119.
  const image = new Set();
  for (let c = 1; c <= 119; c += 1) { assert.ok(map[c] >= 1 && map[c] <= 119); image.add(map[c]); }
  assert.equal(image.size, 119, 'every source channel is used exactly once');
});

test('_176 §3.5: w and a NEVER swap — the mapping is role-for-role, per pixel', () => {
  const pixels = LIVE_REGISTRY.get('ShehdsBar').pixels;
  const map = reversedDmxChannelMap({ kind: 'dmx', footprintCh: 119, defPixels: pixels });
  for (let p = 0; p < 18; p += 1) {
    const to = pixels[p].channels;
    const from = pixels[17 - p].channels;
    for (const role of ['red', 'green', 'blue', 'white', 'amber', 'violet']) {
      assert.equal(map[to[role]], from[role],
        `pixel ${p + 1}'s ${role} must come from pixel ${18 - p}'s ${role}, never another lane`);
    }
    // The decisive one: white must never be fed by amber, in either direction.
    assert.notEqual(map[to.white], from.amber);
    assert.notEqual(map[to.amber], from.white);
  }
});

test('_176 §3.5: Vintage reverses six heads across NON-CONTIGUOUS lanes, controls untouched', () => {
  const pixels = LIVE_REGISTRY.get('VintageLed').pixels;
  const map = reversedDmxChannelMap({ kind: 'dmx', footprintCh: 33, defPixels: pixels });
  // `value` 3..8 ↔ 8..3, head-wise.
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(c => map[c]), [8, 7, 6, 5, 4, 3]);
  // `rgb` triplets swap HEAD order with r→r / g→g / b→b inside each head.
  assert.deepEqual([16, 17, 18].map(c => map[c]), [31, 32, 33], 'head 1 rgb ← head 6 rgb');
  assert.deepEqual([19, 20, 21].map(c => map[c]), [28, 29, 30], 'head 2 rgb ← head 5 rgb');
  assert.deepEqual([31, 32, 33].map(c => map[c]), [16, 17, 18], 'head 6 rgb ← head 1 rgb');
  // Controls 1,2 and 9-15 are shared/global and must be identity-copied.
  for (const c of [1, 2, 9, 10, 11, 12, 13, 14, 15]) {
    assert.equal(map[c], c, `Vintage control channel ${c} is shared — it must not be permuted`);
  }
});

// ── 3. Slice shapes ────────────────────────────────────────────────────────

test('_176 §3.5: reversed DMX slices merge into maximal runs and cover the footprint once', () => {
  const bar = { kind: 'dmx', name: 'Bar Left', fixtureType: 'ShehdsBar', footprintCh: 119,
    addr: 107, universe: 2, defPixels: LIVE_REGISTRY.get('ShehdsBar').pixels };
  const src = { name: 'Left Front Wall 1', fixtureType: 'ShehdsBar', universe: 2, addr: 1 };
  const slices = computeSlices(bar, src, { reverse: true });
  // One 11-channel control run + 18 six-channel pixel runs.
  assert.equal(slices.length, 19);
  assert.deepEqual(slices[0], { sourceUniverse: 2, sourceAddr: 1, destAddr: 107, length: 11,
    note: slices[0].note });
  assert.equal(slices.filter(s => s.length === 6).length, 18);
  assert.equal(slices.reduce((n, s) => n + s.length, 0), 119, 'total coverage is the footprint');
  const claimed = new Set();
  for (const s of slices) {
    for (let i = 0; i < s.length; i += 1) {
      assert.equal(claimed.has(s.destAddr + i), false, 'no destination channel twice');
      claimed.add(s.destAddr + i);
    }
  }
  assert.equal(claimed.size, 119);
  assert.match(slices[0].note, /REVERSED 18 px/, 'the slice note says which way round it runs');

  // Vintage: 2 identity runs (1-2, 9-15) + 6 one-channel `value` slices + 6
  // three-channel rgb head slices.
  const vintage = { kind: 'dmx', name: 'Vintage Left', fixtureType: 'VintageLed', footprintCh: 33,
    addr: 41, universe: 2, defPixels: LIVE_REGISTRY.get('VintageLed').pixels };
  const vSlices = computeSlices(vintage, { name: 'Left Front Rails 1', fixtureType: 'VintageLed',
    universe: 5, addr: 1 }, { reverse: true });
  assert.equal(vSlices.length, 14);
  assert.equal(vSlices.reduce((n, s) => n + s.length, 0), 33);
  assert.deepEqual(vSlices.map(s => s.length), [2, 1, 1, 1, 1, 1, 1, 7, 3, 3, 3, 3, 3, 3]);
});

test('_176: the NORMAL path is byte-identical to the pre-feature single-slice copy', () => {
  const bar = { kind: 'dmx', name: 'Bar Left', fixtureType: 'ShehdsBar', footprintCh: 119,
    addr: 107, universe: 2, defPixels: LIVE_REGISTRY.get('ShehdsBar').pixels };
  const src = { name: 'Left Front Wall 1', fixtureType: 'ShehdsBar', universe: 2, addr: 1 };
  const expected = [{ sourceUniverse: 2, sourceAddr: 1, length: 119, destAddr: 107,
    note: 'Left Front Wall 1 (ShehdsBar, 119 ch)' }];
  assert.deepEqual(computeSlices(bar, src), expected, 'no options at all');
  assert.deepEqual(computeSlices(bar, src, {}), expected, 'empty options');
  assert.deepEqual(computeSlices(bar, src, { reverse: false }), expected, 'explicit NORMAL');
});

// ── 4. LIVE: the observed opposite-X order, and REVERSED aligning it ───────

for (const [slot, benchFixture, shipFixture] of [
  ['bar_left', 'Bar Left', 'Left Front Wall 1'],
  ['bar_right', 'Bar Right', 'Left Front Wall 2'],
]) {
  test(`_176 §4 LIVE: ${shipFixture} → ${benchFixture} — NORMAL runs backwards, REVERSED aligns`,
    async () => {
      // PRECONDITION, stated out loud. This tier reads the generated model's
      // per-pixel WIRE association, which Mechanism A (the scene-level
      // NORMAL/REVERSED flag) is allowed to permute at export. Neither fixture
      // carries such a flag today, so model `localIndex` and definition pixel
      // index coincide and the pairing assertions below mean what they say. If
      // an operator ever flags one of these two fixtures, this precondition
      // fires FIRST — a loud "recompute the expectation", never a silent pass
      // against a model that moved underneath it.
      for (const [scene, fixture] of [['test_bench', benchFixture], ['titanic', shipFixture]]) {
        const store = liveScene(scene).sceneConfig.pixelOrder || {};
        assert.equal(store[fixture], undefined,
          `${scene}/${fixture} now carries a scene-level pixel-order flag; this LIVE tier ` +
          'compares model wire association against definition pixel index and must be updated');
      }
      const destPx = await fixturePixels('test_bench', benchFixture);
      const srcPx = await fixturePixels('titanic', shipFixture);
      assert.equal(destPx.length, 18);
      assert.equal(srcPx.length, 18);

      // THE OBSERVED FACT, read off the committed models rather than asserted
      // from memory: the two fixtures' as-built pixel-0→N directions disagree.
      assert.ok(strictlyDecreasing(destPx.map(p => p.x)),
        `${benchFixture} localIndex 0→17 must run toward DECREASING x`);
      assert.ok(strictlyIncreasing(srcPx.map(p => p.x)),
        `${shipFixture} localIndex 0→17 must run toward INCREASING x`);

          // The generated model names lanes with the SHORT role keys the engine
      // uses (r/g/b/w/a/u), not the definition's long ones.
      const LANES = ['r', 'g', 'b', 'w', 'a', 'u'];
      const srcByRed = new Map(srcPx.map(p => [`${p.universe}/${p.abs.r}`, p]));
      /** Which SOURCE pixel feeds each destination pixel, under `reverse`. */
      const pairing = (reverse) => {
        const map = channelMapOf(resolveLive(reverse ? { [slot]: true } : {}));
        return destPx.map((d) => {
          const fed = map.get(`${d.universe}/${d.abs.r}`);
          assert.ok(fed, `dest ${benchFixture} px ${d.localIndex} must be fed at all`);
          const s = srcByRed.get(fed);
          assert.ok(s, `dest px ${d.localIndex} is fed by ${fed}, which is no source PIXEL ` +
            'channel — a reversal must never feed a pixel lane from a control channel');
          // Role fidelity, on the SAME pairing: every lane of this destination
          // pixel comes from the same lane of that source pixel.
          for (const role of LANES) {
            assert.equal(map.get(`${d.universe}/${d.abs[role]}`), `${s.universe}/${s.abs[role]}`,
              `px ${d.localIndex} lane ${role} must come from the same lane`);
          }
          return s;
        });
      };

      // NORMAL: block-for-block, localIndex k ← localIndex k. Because the two
      // fixtures run opposite ways, that is exactly the backwards sweep the
      // operator saw.
      const normal = pairing(false);
      assert.deepEqual(normal.map(s => s.localIndex), destPx.map(d => d.localIndex),
        'NORMAL is an identity block copy');
      const destAscending = [...destPx].sort((a, b) => a.x - b.x);
      const normalByX = destAscending.map(d => normal[destPx.indexOf(d)].x);
      assert.ok(strictlyDecreasing(normalByX),
        'NORMAL: walking the bench left→right walks the ship right→left — the observed defect');

      // REVERSED: localIndex k ← localIndex 17-k, and the x orders now agree.
      const reversed = pairing(true);
      assert.deepEqual(reversed.map(s => s.localIndex),
        destPx.map(d => 17 - d.localIndex), 'REVERSED is the end-for-end block copy');
      const reversedByX = destAscending.map(d => reversed[destPx.indexOf(d)].x);
      assert.ok(strictlyIncreasing(reversedByX),
        'REVERSED: walking the bench left→right walks the ship left→right — aligned');
    });
}

test('_176 §4 LIVE: reversing ONE slot leaves every other destination channel untouched', () => {
  const normal = channelMapOf(resolveLive());
  const flipped = channelMapOf(resolveLive({ bar_left: true }));
  assert.equal(normal.size, flipped.size, 'the same destination channels are written either way');
  const moved = [...normal.keys()].filter(k => normal.get(k) !== flipped.get(k));
  // Bar Left is at U2/107 with footprint 119; its 11 control channels are
  // identity-copied, so exactly 108 channels move.
  assert.equal(moved.length, 108);
  for (const key of moved) {
    const ch = Number(key.split('/')[1]);
    assert.ok(ch >= 107 + 11 && ch <= 107 + 118,
      `channel ${key} moved but is outside Bar Left's PIXEL region — a reversal must be local`);
  }
});

test('_176 §4 LIVE: a reversed slot still passes every structural invariant', () => {
  const out = resolveLive({ bar_left: true, bar_right: true, vintage_left: true, led_0: true });
  assert.equal(out.ok, true, out.refusal || '');
  // `validateMirrorTree` already ran inside the resolver (R-19 would have
  // refused); this asserts the operator-visible reporting came with it.
  const byId = new Map(out.slots.map(s => [s.slot, s]));
  assert.equal(byId.get('bar_left').reverse, true);
  assert.equal(byId.get('bar_left').reverseApplicable, true);
  assert.match(byId.get('bar_left').summary, /· REVERSED$/);
  assert.equal(byId.get('par_1').reverse, false);
  assert.equal(byId.get('par_1').reverseApplicable, false);
  assert.doesNotMatch(byId.get('par_1').summary, /REVERSED/);
});

test('_176 §3.5: byte level — a reversed Vintage keeps its shared controls and swaps its heads',
  () => {
    const out = resolveLive({ vintage_left: true });
    assert.equal(out.ok, true, out.refusal || '');
    const slot = out.slots.find(s => s.slot === 'vintage_left');
    const benchPatch = liveScene('test_bench').patches.patches[slot.benchFixture];
    const srcPatch = liveScene('titanic').patches.patches[slot.source];
    const state = createMirrorState(out.spec);
    // A per-channel-unique ramp over the whole 33-channel source fixture: every
    // byte identifies the channel it came from, so any mis-permutation shows up
    // as a wrong number rather than as a coincidence.
    const payload = {};
    for (let c = 1; c <= 33; c += 1) payload[srcPatch.dmxAddress + c - 1] = c * 7;
    spliceMirrorFrame(state, srcPatch.dmxUniverse, payload);
    const composed = mirrorPayload(state, `${benchPatch.dmxUniverse}→${benchPatch.controllerIp}`);
    const at = (c) => composed[benchPatch.dmxAddress + c - 1];

    // Shared / global controls: dimming, strobe, aux colour, macros — identity.
    for (const c of [1, 2, 9, 10, 11, 12, 13, 14, 15]) {
      assert.equal(at(c), c * 7,
        `Vintage control channel ${c} is GLOBAL — a reversal must copy it unchanged`);
    }
    // Six heads, end for end, on both of the non-contiguous lane blocks.
    for (let head = 0; head < 6; head += 1) {
      assert.equal(at(3 + head), (8 - head) * 7,
        `head ${head + 1}'s value lane must come from head ${6 - head}'s value lane`);
      for (let lane = 0; lane < 3; lane += 1) {
        assert.equal(at(16 + head * 3 + lane), (31 - head * 3 + lane) * 7,
          `head ${head + 1} rgb lane ${lane} must come from head ${6 - head}'s SAME lane`);
      }
    }
  });

// ── 5. LED strands: whole blocks, first-N window, then reverse ─────────────

test('_176 §3.5: an LED slot swaps WHOLE stride blocks and never reorders bytes inside one',
  () => {
    const out = resolveLive({ led_0: true });
    assert.equal(out.ok, true, out.refusal || '');
    const led = out.slots.find(s => s.slot === 'led_0');
    const patch = liveScene('test_bench').patches.patches[led.benchFixture];
    const mirror = out.spec.mirrors.find(m => m.destUniverse === patch.dmxUniverse);
    assert.equal(mirror.slices.length, patch.pixelCount,
      'a reversed strand is one slice per pixel — source addresses run backwards, so no two ' +
      'pixels are contiguous on both sides');
    for (const s of mirror.slices) {
      assert.equal(s.length, 4, 'each slice is exactly one whole RGBW pixel');
      assert.equal((s.destAddr - patch.dmxAddress) % 4, 0, 'and lands on a pixel boundary');
      assert.equal((s.sourceAddr - 1) % 4, 0, 'reading from one too — bytes never rotate');
    }
  });

test('_176 §3.5: 40 px → 20 px keeps the FIRST 20 and reverses THOSE (not the last 20)', () => {
  const srcPatch = liveScene('titanic').patches.patches.Left_Front_Left;
  const out = resolveLive({ led_0: true });
  const led = out.slots.find(s => s.slot === 'led_0');
  const patch = liveScene('test_bench').patches.patches[led.benchFixture];
  assert.equal(srcPatch.pixelCount, 40);
  assert.equal(patch.pixelCount, 20);
  const mirror = out.spec.mirrors.find(m => m.destUniverse === patch.dmxUniverse);
  const sources = mirror.slices.map(s => s.sourceAddr).sort((a, b) => a - b);
  const firstWindow = Array.from({ length: 20 }, (_, i) => srcPatch.dmxAddress + i * 4);
  const lastWindow = Array.from({ length: 20 }, (_, i) => srcPatch.dmxAddress + (i + 20) * 4);
  assert.deepEqual(sources, firstWindow,
    'the mirrored window is still rope pixels 1-20 — reversing changes WHICH END lands on ' +
    'bench pixel 1, never which part of the rope is shown');
  // The explicit counterexample the design demands.
  assert.notDeepEqual(sources, lastWindow);
  // …and within that window it really is end-for-end.
  const inOrder = mirror.slices.slice().sort((a, b) => a.destAddr - b.destAddr);
  assert.deepEqual(inOrder.map(s => s.sourceAddr), firstWindow.slice().reverse());
  // NORMAL, for contrast: one merged run over the same window, forwards.
  const normal = resolveLive();
  const nMirror = normal.spec.mirrors.find(m => m.destUniverse === patch.dmxUniverse);
  assert.equal(nMirror.slices.length, 1, 'the NORMAL strand copy is still ONE merged slice');
  assert.equal(nMirror.slices[0].sourceAddr, srcPatch.dmxAddress);
  assert.equal(nMirror.slices[0].length, 80);
});

test('_176 §3.5: byte level — a reversed strand delivers whole pixels, end for end', () => {
  const out = resolveLive({ led_0: true });
  const led = out.slots.find(s => s.slot === 'led_0');
  const patch = liveScene('test_bench').patches.patches[led.benchFixture];
  const srcPatch = liveScene('titanic').patches.patches.Left_Front_Left;
  const state = createMirrorState(out.spec);
  // Source pixel n (1-based) = (n, n+50, n+100, n+150) — every byte distinct, so
  // a rotated lane or a half-pixel copy could not hide.
  const payload = {};
  for (let px = 0; px < 40; px += 1) {
    for (let lane = 0; lane < 4; lane += 1) {
      payload[srcPatch.dmxAddress + px * 4 + lane] = (px + 1 + lane * 50) & 0xff;
    }
  }
  spliceMirrorFrame(state, srcPatch.dmxUniverse, payload);
  const composed = mirrorPayload(state, `${patch.dmxUniverse}→${patch.controllerIp}`);
  for (let px = 0; px < 20; px += 1) {
    const wantSourcePx = 20 - px;              // bench px 1 shows window px 20
    for (let lane = 0; lane < 4; lane += 1) {
      assert.equal(composed[patch.dmxAddress + px * 4 + lane],
        (wantSourcePx + lane * 50) & 0xff,
        `bench pixel ${px + 1} lane ${lane} must carry source pixel ${wantSourcePx}'s same lane`);
    }
  }
});

// ── 6. Refusals ───────────────────────────────────────────────────────────

test('_176 R-25: a PAR can never be reversed — refused by name, not ignored', () => {
  const out = resolveLive({ par_1: true });
  assert.equal(out.ok, false);
  assert.match(out.refusal, new RegExp(`ARM refused \\[${REFUSALS.REVERSE_NOT_APPLICABLE}\\]`));
  assert.match(out.refusal, /slot 'par_1' \('Par 1'\) was armed REVERSED/);
  assert.match(out.refusal, /is a 1-pixel fixture — reversing its pixel order is meaningless/);
  assert.match(out.refusal, /Refusing rather than ignoring it/);
  // …and the picker is told up front, so the control is never even offered.
  const normal = resolveLive();
  assert.equal(normal.slots.find(s => s.slot === 'par_1').reverseApplicable, false);
  assert.equal(destPixelCount({ kind: 'dmx', defPixels: LIVE_REGISTRY.get('UkingPar').pixels }), 1);
});

test('_176 R-25: reverse on a HELD-DARK par is still refused — it does not vanish with the none',
  () => {
    const selection = Object.fromEntries(LIVE_SPEC.slots.map(s => [s.slot,
      { source: s.slot === 'par_1' ? null : s.defaultSource, reverse: s.slot === 'par_1' }]));
    const out = resolveBenchMirror({
      spec: LIVE_SPEC, benchSceneName: 'test_bench', benchScene: liveScene('test_bench'),
      sourceSceneName: 'titanic', sourceScene: liveScene('titanic'),
      registry: LIVE_REGISTRY, selection,
    });
    assert.equal(out.ok, false);
    assert.match(out.refusal, /R-25/);
  });

test('_176 R-24: the OLD flat selection shape is refused BY NAME, with the new one spelled out',
  () => {
    for (const bad of ['Left Auditorium 5', null]) {
      const selection = Object.fromEntries(LIVE_SPEC.slots.map(s => [s.slot,
        { source: s.defaultSource, reverse: false }]));
      selection.par_1 = bad;
      const out = resolveBenchMirror({
        spec: LIVE_SPEC, benchSceneName: 'test_bench', benchScene: liveScene('test_bench'),
        sourceSceneName: 'titanic', sourceScene: liveScene('titanic'),
        registry: LIVE_REGISTRY, selection,
      });
      assert.equal(out.ok, false, `${JSON.stringify(bad)} must be refused`);
      assert.match(out.refusal, new RegExp(`ARM refused \\[${REFUSALS.SELECTION_SHAPE}\\]`));
      assert.match(out.refusal, /carries the OLD selection shape/);
      assert.match(out.refusal, /reverse: true \| false/);
      assert.match(out.refusal, /does not accept both/);
    }
  });

test('_176 R-24: a non-boolean reverse, or an unknown entry key, is refused', () => {
  const build = (entry) => {
    const selection = Object.fromEntries(LIVE_SPEC.slots.map(s => [s.slot,
      { source: s.defaultSource, reverse: false }]));
    selection.bar_left = entry;
    return resolveBenchMirror({
      spec: LIVE_SPEC, benchSceneName: 'test_bench', benchScene: liveScene('test_bench'),
      sourceSceneName: 'titanic', sourceScene: liveScene('titanic'),
      registry: LIVE_REGISTRY, selection,
    });
  };
  for (const bad of ['true', 1, undefined, null]) {
    const out = build({ source: 'Left Front Wall 1', reverse: bad });
    assert.equal(out.ok, false, `reverse=${JSON.stringify(bad)} must be refused`);
    assert.match(out.refusal, /R-24/);
    assert.match(out.refusal, /not a boolean|OLD selection shape/);
  }
  const unknown = build({ source: 'Left Front Wall 1', reverse: false, pixelOrdering: 'reversed' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.refusal, /unknown key 'pixelOrdering'/);
  const listy = build([1, 2]);
  assert.equal(listy.ok, false);
  assert.match(listy.refusal, /R-24/);
});

// ── 7. The composition contract (§4) ──────────────────────────────────────

test('_176 §4: the resolver is CONTRACTUALLY FORBIDDEN from reading a scene pixel-order store',
  () => {
    // The mirror is wire→wire. Each scene's own pixel-order correction is
    // already baked into its exported model, upstream of the wire, so a resolver
    // that ALSO consulted that store would apply the same correction twice. The
    // guarantee is the ABSENCE of a code path, so the thing to check is the code.
    const files = [
      path.join(SIM_ROOT, 'lib', 'bench_mirror_resolve.cjs'),
      path.join(SIM_ROOT, 'lib', 'bench_mirror.cjs'),
      path.join(SIM_ROOT, 'lib', 'bench_mirror_state.cjs'),
      path.join(SIM_ROOT, 'server', 'sacn_bridge.js'),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(src, /\bpixelOrder\b/,
        `${path.basename(file)} must never read the scene-level pixel-order store — the mirror ` +
        'composes WIRE bytes, in which each scene\'s own correction is already applied');
      assert.doesNotMatch(src, /pixel_order/,
        `${path.basename(file)} must not require the pixel-order store module`);
    }
  });

test('_176 §4: the slot toggle is pure RELATIVE orientation — it needs no scene input', () => {
  // Structural statement of `M = G_s ∘ G_d`: everything `computeSlices` can see
  // is the two fixtures' patches plus the shared fixture definition. Feeding it
  // scene trees that differ in every way EXCEPT those inputs must change
  // nothing, which is only true because no scene-level flag is an input.
  const bar = { kind: 'dmx', name: 'Bar Left', fixtureType: 'ShehdsBar', footprintCh: 119,
    addr: 107, universe: 2, defPixels: LIVE_REGISTRY.get('ShehdsBar').pixels };
  const src = { name: 'Left Front Wall 1', fixtureType: 'ShehdsBar', universe: 2, addr: 1 };
  const a = computeSlices(bar, src, { reverse: true });
  const b = computeSlices({ ...bar }, { ...src }, { reverse: true });
  assert.deepEqual(a, b);
  assert.equal(computeSlices.length, 3,
    'computeSlices takes (dest, src, opts) — there is no fourth, scene-shaped argument');
});
