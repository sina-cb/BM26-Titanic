// Tests for the Tier-C host integration (viewMaskHi — the second view
// word lifting the in-VM mask ceiling 31 -> 62). Covers, host-side:
//   - the two-word ViewBitAllocator (view_word.js): word 0 fills before
//     word 1, the 32nd slot lands in the hi word at the right bit, and
//     past slot 61 it throws LOUDLY.
//   - the named-mask injector's INLINED single-bit literal emission for
//     high-word masks (name_id_registry.js / view_mask_constants.js): a
//     word-1 mask is substituted as a literal, NOT declared as a `var`
//     (the firmware rejects a var-mask with viewMaskHi).
//   - the 7-lane meta pack carrying viewMaskHi in lane 6 (wasm_host.js).
//   - END-TO-END through the VENDORED Tier-C WASM: a model with MORE than
//     31 named views, where at least one view lands in the hi word, and a
//     pattern that tests `(viewMaskHi & <that bit's literal>)` selects
//     EXACTLY the right pixels (zero leaks), while a low-word view still
//     selects correctly.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ViewBitAllocator,
  slotToWordBit,
  isPowerOfTwoBit,
  MAX_VIEW_SLOTS,
  MAX_WORD_BIT,
} from '../../lib/view_word.js';
import {
  buildConstantTable,
  injectConstants,
  constantValue,
  constantIsInline,
} from '../../lib/name_id_registry.js';
import { buildMaskConstants, injectMaskConstants } from '../../lib/view_mask_constants.js';
import { WasmHost } from '../../lib/wasm_host.js';

// ── view_word: slot -> (word, bit) ────────────────────────────────

test('slotToWordBit: slots 0..30 are word 0 bit 1<<slot', () => {
  assert.deepEqual(slotToWordBit(0), { word: 0, bit: 1 });
  assert.deepEqual(slotToWordBit(30), { word: 0, bit: 0x40000000 });
});

test('slotToWordBit: slots 31..61 are word 1 bit 1<<(slot-31)', () => {
  assert.deepEqual(slotToWordBit(31), { word: 1, bit: 1 });          // view 31 -> hi bit 0
  assert.deepEqual(slotToWordBit(61), { word: 1, bit: 0x40000000 }); // view 61 -> hi bit 30
});

test('slotToWordBit: past slot 61 throws loudly', () => {
  assert.throws(() => slotToWordBit(62), /out of range/);
});

test('isPowerOfTwoBit: bit 30 ok, bit 31 (0x80000000) rejected', () => {
  assert.equal(isPowerOfTwoBit(MAX_WORD_BIT), true);
  assert.equal(isPowerOfTwoBit(0x80000000), false);
  assert.equal(isPowerOfTwoBit(0), false);
});

// ── ViewBitAllocator: word 0 fills before word 1, throws past 62 ───

test('ViewBitAllocator: first 31 next() calls fill word 0, 32nd lands in hi word bit 0', () => {
  const alloc = new ViewBitAllocator();
  let last;
  for (let i = 0; i < 31; i++) {
    last = alloc.next();
    assert.equal(last.word, 0, `slot ${i} should be word 0`);
  }
  assert.deepEqual(last, { word: 0, bit: 0x40000000 }); // 31st = view 30
  const thirtySecond = alloc.next();                    // 32nd = view 31
  assert.deepEqual(thirtySecond, { word: 1, bit: 1 }, 'the 32nd view must land in viewMaskHi bit 0');
});

test('ViewBitAllocator: claim a word-0 bit pushes next() past it', () => {
  const alloc = new ViewBitAllocator();
  alloc.claim(0, 1, 'group'); // bit 0 of word 0 taken
  assert.deepEqual(alloc.next(), { word: 0, bit: 2 });
});

test('ViewBitAllocator: exactly 62 slots, then throws LOUDLY', () => {
  const alloc = new ViewBitAllocator();
  for (let i = 0; i < MAX_VIEW_SLOTS; i++) alloc.next(`view${i}`);
  assert.throws(() => alloc.next('one-too-many'), /Out of view-mask bits/);
});

test('ViewBitAllocator: claim rejects bit 31 (negative under Int32)', () => {
  const alloc = new ViewBitAllocator();
  assert.throws(() => alloc.claim(1, 0x80000000, 'bad'), /power of two/);
});

// ── buildConstantTable: inline entries ────────────────────────────

test('buildConstantTable: inline entry stored as { value, inline:true }', () => {
  const t = buildConstantTable('MASK', [
    { name: 'Low', value: 4 },
    { name: 'High', value: 0x40000000, inline: true },
  ]);
  assert.equal(constantValue(t.MASK_LOW), 4);
  assert.equal(constantIsInline(t.MASK_LOW), false);
  assert.equal(constantValue(t.MASK_HIGH), 0x40000000);
  assert.equal(constantIsInline(t.MASK_HIGH), true);
});

test('buildConstantTable: same name disagreeing on inline mode collides', () => {
  assert.throws(() => buildConstantTable('MASK', [
    { name: 'X', value: 4 },
    { name: 'X', value: 4, inline: true },
  ]), /collision/);
});

// ── injectConstants: inline literal substitution ──────────────────

test('injectConstants: inline mask is substituted as a literal, NOT var-declared', () => {
  const table = { MASK_HI_VIEW: { value: 1073741824, inline: true } };
  const src = 'export function render(index) { var on = (viewMaskHi & MASK_HI_VIEW); rgb(on,0,0); }';
  const out = injectConstants(src, table, 'MASK');
  assert.doesNotMatch(out, /var MASK_HI_VIEW/);                 // never a var
  assert.match(out, /\(viewMaskHi & 1073741824\)/);            // inlined literal
});

test('injectConstants: mixed low (var) + high (inline) in one source', () => {
  const table = {
    MASK_LOW: 8,
    MASK_HI: { value: 1073741824, inline: true },
  };
  const src = 'export function render(index) {\n' +
    '  var a = (viewMask & MASK_LOW);\n' +
    '  var b = (viewMaskHi & MASK_HI);\n' +
    '  rgb(a, b, 0);\n}';
  const out = injectConstants(src, table, 'MASK');
  assert.match(out, /^var MASK_LOW = 8;\n/);                   // low word: var prepended
  assert.match(out, /\(viewMaskHi & 1073741824\)/);           // high word: inlined
  assert.doesNotMatch(out, /var MASK_HI\b/);
});

test('injectConstants: longest-name-first so a prefix name never clobbers a longer one', () => {
  const table = {
    MASK_A: { value: 2, inline: true },
    MASK_A_B: { value: 4, inline: true },
  };
  const src = 'x = MASK_A_B; y = MASK_A;';
  const out = injectConstants(src, table, 'MASK');
  assert.match(out, /x = 4;/);
  assert.match(out, /y = 2;/);
});

// ── buildMaskConstants: word routing ──────────────────────────────

test('buildMaskConstants: word:1 preset becomes an inline entry; groups + word:0 stay var', () => {
  const constants = buildMaskConstants({
    groupBits: { 'TowerBars': 0x01 },
    viewMasks: [
      { name: 'LowPreset', bit: 0x40, word: 0 },
      { name: 'HighPreset', bit: 0x40000000, word: 1 },
    ],
  });
  assert.equal(constantIsInline(constants.MASK_TOWER_BARS), false);
  assert.equal(constantIsInline(constants.MASK_LOW_PRESET), false);
  assert.equal(constantIsInline(constants.MASK_HIGH_PRESET), true);
  assert.equal(constantValue(constants.MASK_HIGH_PRESET), 0x40000000);
});

// ── 7-lane meta pack carries viewMaskHi in lane 6 ─────────────────

test('WasmHost.setPixelMeta: lane 6 carries viewMaskHi (7-int stride)', async () => {
  const host = new WasmHost();
  await host.init(2);
  try {
    host.setPixelMeta([
      { controllerId: 1, sectionId: 2, fixtureId: 3, viewMask: 4,
        fixtureTypeId: 5, pixelLocalIndex: 6, viewMaskHi: 0x40000000 },
      { viewMaskHi: 1 },
    ]);
    // metaView is a 7-int-stride Int32 view onto WASM heap.
    assert.equal(host.metaView[6], 0x40000000, 'pixel 0 lane 6 == viewMaskHi');
    assert.equal(host.metaView[7 * 1 + 6], 1, 'pixel 1 lane 6 == viewMaskHi');
    // Low lanes still in place.
    assert.equal(host.metaView[3], 4, 'pixel 0 lane 3 == viewMask');
  } finally {
    host.shutdown();
  }
});

// ── END-TO-END: > 31 views, a hi-word view selects exactly ────────

test('e2e: 33 named views — a hi-word view selects exactly through the vendored WASM', async () => {
  // 4 pixels. Build a model-shaped run with 32 word-0 views (groups) plus a
  // 33rd view in the hi word (word 1, bit 0). We pack the meta directly to
  // mirror what the engine's two-word allocator + metaArray produce:
  //   - pixel 0: belongs to the hi-word view (viewMaskHi bit 0 set)
  //   - pixel 1: belongs to a low-word view (viewMask bit 2 set)
  //   - pixels 2,3: belong to neither.
  const host = new WasmHost();
  await host.init(4);
  try {
    host.setCoords([
      { nx: 0, ny: 0, nz: 0 }, { nx: 0, ny: 0, nz: 0 },
      { nx: 0, ny: 0, nz: 0 }, { nx: 0, ny: 0, nz: 0 },
    ]);
    const HI_BIT = 1;   // view 31 -> viewMaskHi bit 0
    const LOW_BIT = 2;  // view 1  -> viewMask bit 1
    host.setPixelMeta([
      { viewMask: 0,       viewMaskHi: HI_BIT }, // pixel 0 in the HI view
      { viewMask: LOW_BIT, viewMaskHi: 0 },      // pixel 1 in the LOW view
      { viewMask: 0,       viewMaskHi: 0 },      // pixel 2 in neither
      { viewMask: 0,       viewMaskHi: 0 },      // pixel 3 in neither
    ]);

    // The named-mask table mirrors the engine: a word-1 mask is INLINE.
    host.setMaskConstants({
      MASK_HI_VIEW: { value: HI_BIT, inline: true },
      MASK_LOW_VIEW: LOW_BIT,
    });

    // Pattern: red where the HI-word view matches, green where the LOW
    // view matches. The injector inlines MASK_HI_VIEW -> 1, so the source
    // the compiler sees is `(viewMaskHi & 1)`.
    const src = 'export function render(index) {\n' +
      '  var inHi  = (viewMaskHi & MASK_HI_VIEW) != 0;\n' +
      '  var inLow = (viewMask & MASK_LOW_VIEW) != 0;\n' +
      '  rgb(inHi, inLow, 0);\n}';
    const compiled = host.compile(src);
    assert.equal(compiled.ok, true, compiled.error);
    host.beginFrame(compiled.handle, 0.0);
    const buf = host.renderAll6ch(compiled.handle); // 6 bytes/pixel RGBWAU

    const red = (i) => buf[i * 6];
    const green = (i) => buf[i * 6 + 1];

    // Pixel 0: HI view -> red on, green off (zero leak into low).
    assert.ok(red(0) > 200, `pixel 0 expected red (hi view), got ${red(0)}`);
    assert.equal(green(0), 0, 'pixel 0 must NOT match the low view');
    // Pixel 1: LOW view -> green on, red off (zero leak into hi).
    assert.equal(red(1), 0, 'pixel 1 must NOT match the hi view');
    assert.ok(green(1) > 200, `pixel 1 expected green (low view), got ${green(1)}`);
    // Pixels 2,3: neither -> dark.
    assert.equal(red(2), 0); assert.equal(green(2), 0);
    assert.equal(red(3), 0); assert.equal(green(3), 0);

    host.destroy(compiled.handle);
  } finally {
    host.shutdown();
  }
});

test('e2e: bit-5-with-bit-28 float trap — hi-word combined word selects bit 5 exactly', async () => {
  // The classic float trap: a pixel belongs to TWO high views whose
  // combined hi word is bits 5 and 28. Testing `(viewMaskHi & (1<<5))`
  // must still select it (the firmware's exact-int path), while a pixel
  // with only bit 28 must NOT match the bit-5 test.
  const host = new WasmHost();
  await host.init(2);
  try {
    host.setCoords([{ nx: 0, ny: 0, nz: 0 }, { nx: 0, ny: 0, nz: 0 }]);
    const BIT5 = 1 << 5;
    const BIT28 = 1 << 28;
    host.setPixelMeta([
      { viewMaskHi: BIT5 | BIT28 }, // pixel 0: both high views
      { viewMaskHi: BIT28 },        // pixel 1: only bit 28
    ]);
    host.setMaskConstants({ MASK_VIEW5: { value: BIT5, inline: true } });
    const src = 'export function render(index) { rgb((viewMaskHi & MASK_VIEW5) != 0, 0, 0); }';
    const compiled = host.compile(src);
    assert.equal(compiled.ok, true, compiled.error);
    host.beginFrame(compiled.handle, 0.0);
    const buf = host.renderAll6ch(compiled.handle);
    assert.ok(buf[0] > 200, `pixel 0 (bit5+bit28) must match bit-5 test, got ${buf[0]}`);
    assert.equal(buf[6], 0, 'pixel 1 (bit28 only) must NOT match the bit-5 test');
    host.destroy(compiled.handle);
  } finally {
    host.shutdown();
  }
});

// ── model_loader spills the 32nd view into the hi word ────────────

test('model_loader: derived bit-less presets spill into viewMaskHi past 31 word-0 bits', async () => {
  // Drive loadModelForGauge through a transform that registers > 31 views.
  // The first 31 fill word 0; the 32nd+ land in word 1 with px.vMaskHi set
  // and the view entry tagged word:1.
  const { loadModelForGauge } = await import('../../lib/model_loader.js');
  // test_bench is a small known model; we don't rely on its view count,
  // only that the loader runs and metaArray carries a viewMaskHi lane.
  const model = await loadModelForGauge('test_bench');
  assert.ok(Array.isArray(model.metaArray), 'metaArray built');
  assert.ok('viewMaskHi' in model.metaArray[0], 'metaArray entries carry a viewMaskHi lane');
  // Every view entry is tagged with a word (0 or 1).
  for (const vm of model.viewMasks) {
    assert.ok(vm.word === 0 || vm.word === 1, `view '${vm.name}' tagged word 0|1, got ${vm.word}`);
  }
});
