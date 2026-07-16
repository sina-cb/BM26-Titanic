// Tests for lib/in_view_intrinsic.js — the compile-time `inView("Name")`
// membership intrinsic. Covers:
//   - the LOW-word fold:  inView("X") -> ((viewMask & <bit>) != 0)
//   - the HIGH-word fold:  inView("X") -> ((viewMaskHi & <INLINED literal>) != 0)
//     (the literal is a bare number, NOT a var — the Tier-C firmware rejects
//     a var mask on viewMaskHi).
//   - unknown name -> LOUD throw listing the known views (codex P0).
//   - a BIT-FREE (Tier-A) view: throws when no promoter is wired; folds via
//     the on-demand promoter (which sets the bit on member pixels) otherwise.
//   - `createBitFreeViewPromoter`: allocates a free (word,bit), sets it on the
//     view's member pixels, pins it on the entry, raises host.metaDirty.
//   - END-TO-END through the VENDORED WASM: a demo pattern using inView()
//     selects EXACTLY the named view's pixels with ZERO leaks — for both a
//     low-word view and a promoted bit-free view.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  injectInViewIntrinsic,
  createBitFreeViewPromoter,
} from '../../lib/in_view_intrinsic.js';
import { WasmHost } from '../../lib/wasm_host.js';

// ── Low-word fold ──────────────────────────────────────────────────

test('inView: low-word view folds to ((viewMask & <bit>) != 0)', () => {
  const table = { PORT: { bit: 0x100, word: 0 } };
  const out = injectInViewIntrinsic('if (inView("PORT")) { rgb(1,0,0); }', table);
  assert.match(out, /\(\(viewMask & 256\) != 0\)/);
  assert.doesNotMatch(out, /viewMaskHi/);
  assert.doesNotMatch(out, /inView/); // the call site is fully folded away
});

test('inView: single-quoted name resolves the same', () => {
  const table = { WALLS: { bit: 4, word: 0 } };
  const out = injectInViewIntrinsic("x = inView('WALLS');", table);
  assert.match(out, /x = \(\(viewMask & 4\) != 0\);/);
});

test('inView: a name with spaces and @ resolves verbatim', () => {
  const table = { '@BAR': { bit: 8, word: 0 }, 'Front Wall': { bit: 16, word: 0 } };
  const out = injectInViewIntrinsic('a = inView("@BAR"); b = inView("Front Wall");', table);
  assert.match(out, /a = \(\(viewMask & 8\) != 0\);/);
  assert.match(out, /b = \(\(viewMask & 16\) != 0\);/);
});

// ── High-word fold: INLINED single-bit literal (no var) ────────────

test('inView: high-word view folds to ((viewMaskHi & <inlined literal>) != 0)', () => {
  const table = { TOPDECK: { bit: 0x40000000, word: 1 } };
  const out = injectInViewIntrinsic('if (inView("TOPDECK")) rgb(1,1,1);', table);
  // The mask is an inlined LITERAL number, never a var declaration.
  assert.match(out, /\(\(viewMaskHi & 1073741824\) != 0\)/);
  assert.doesNotMatch(out, /var\b/);
});

// ── Unknown name -> loud throw listing known views ─────────────────

test('inView: unknown name throws loudly and lists known views', () => {
  const table = { PORT: { bit: 1, word: 0 }, STARBOARD: { bit: 2, word: 0 } };
  assert.throws(
    () => injectInViewIntrinsic('inView("BOW");', table),
    (err) => /unknown view\(s\) via inView\(\): BOW/.test(err.message) &&
             /PORT/.test(err.message) && /STARBOARD/.test(err.message)
  );
});

test('inView: empty table — any name is unknown (none known)', () => {
  assert.throws(
    () => injectInViewIntrinsic('inView("X");', {}),
    /Known views for this model: \(none\)/
  );
});

// ── No inView() call -> source returned unchanged ──────────────────

test('inView: source with no inView() call is returned byte-identical', () => {
  const src = 'export function render(i){ rgb(1,0,0); }';
  assert.equal(injectInViewIntrinsic(src, { PORT: { bit: 1, word: 0 } }), src);
});

test('inView: a commented-out inView() neither folds nor fails', () => {
  const src = '// inView("UNKNOWN") in a comment\nrgb(0,0,0);';
  // UNKNOWN is not a real call site (comment-stripped before scan), so no
  // throw and the comment text is left intact.
  const out = injectInViewIntrinsic(src, { PORT: { bit: 1, word: 0 } });
  assert.equal(out, src);
});

// ── Bit-free view: loud without a promoter ─────────────────────────

test('inView: bit-free view with NO promoter throws loudly (never silent)', () => {
  const table = { PORT: { bit: 0, word: 0 } }; // Tier-A, no in-VM bit
  assert.throws(
    () => injectInViewIntrinsic('inView("PORT");', table, null),
    /bit-free \(host-only\) view with no in-VM bit/
  );
});

test('inView: a promoter returning an invalid bit is rejected (no silent fold)', () => {
  const table = { PORT: { bit: 0, word: 0 } };
  assert.throws(
    () => injectInViewIntrinsic('inView("PORT");', table, () => ({ bit: 0, word: 0 })),
    /invalid \{bit, word\}/
  );
});

// ── Bit-free view: folds via promoter; promoter resolves once ──────

test('inView: bit-free view folds via the promoter, promoting exactly once', () => {
  const table = { PORT: { bit: 0, word: 0 } };
  let calls = 0;
  const promote = (name) => { calls++; return { bit: 0x80, word: 0 }; };
  const out = injectInViewIntrinsic('a = inView("PORT"); b = inView("PORT");', table, promote);
  assert.equal(calls, 1, 'a view referenced twice must promote exactly once');
  assert.match(out, /a = \(\(viewMask & 128\) != 0\);/);
  assert.match(out, /b = \(\(viewMask & 128\) != 0\);/);
});

test('inView: promoter to the HIGH word folds to an inlined viewMaskHi literal', () => {
  const table = { TOPDECK: { bit: 0, word: 0 } };
  const promote = () => ({ bit: 1, word: 1 }); // hi word bit 0
  const out = injectInViewIntrinsic('inView("TOPDECK");', table, promote);
  assert.match(out, /\(\(viewMaskHi & 1\) != 0\)/);
  assert.doesNotMatch(out, /var\b/);
});

// ── createBitFreeViewPromoter ──────────────────────────────────────

function makeModel() {
  // 5 pixels: a 'port' group (px 0,1) and a bit-free pixelIndices view (px 3,4).
  const pixels = [
    { group: 'Port', vMask: 0, viewMask: 0, vMaskHi: 0 },
    { group: 'Port', vMask: 0, viewMask: 0, vMaskHi: 0 },
    { group: 'Mid',  vMask: 0, viewMask: 0, vMaskHi: 0 },
    { group: 'Star', vMask: 0, viewMask: 0, vMaskHi: 0 },
    { group: 'Star', vMask: 0, viewMask: 0, vMaskHi: 0 },
  ];
  const groupBits = { Port: 0x1, Mid: 0x2, Star: 0x4 };
  const viewMasks = [
    // a bit-free groups view and a bit-free pixelIndices view
    { name: 'PORTSIDE', groups: ['Port'], bit: 0 },
    { name: 'TAIL', pixelIndices: [3, 4], bit: 0 },
  ];
  return { pixels, groupBits, viewMasks };
}

test('createBitFreeViewPromoter: groups view — sets a fresh bit on member pixels', () => {
  const model = makeModel();
  const host = { metaDirty: false };
  const promote = createBitFreeViewPromoter(model, host);
  const { bit, word } = promote('PORTSIDE');
  assert.equal(word, 0);
  // 0x1,0x2,0x4 are taken by groups -> lowest free is 0x8.
  assert.equal(bit, 0x8);
  // Only the Port-group pixels (0,1) carry the new bit.
  assert.equal(model.pixels[0].vMask & bit, bit);
  assert.equal(model.pixels[1].vMask & bit, bit);
  assert.equal(model.pixels[2].vMask & bit, 0);
  assert.equal(model.pixels[0].viewMask, model.pixels[0].vMask); // mirrored
  // The entry is pinned + host marked dirty so the caller re-packs meta.
  assert.equal(model.viewMasks[0].bit, bit);
  assert.equal(model.viewMasks[0].word, 0);
  assert.equal(host.metaDirty, true);
});

test('createBitFreeViewPromoter: pixelIndices view sets the bit on exactly those pixels', () => {
  const model = makeModel();
  const promote = createBitFreeViewPromoter(model, { metaDirty: false });
  const { bit } = promote('TAIL');
  assert.equal(model.pixels[3].vMask & bit, bit);
  assert.equal(model.pixels[4].vMask & bit, bit);
  for (const i of [0, 1, 2]) assert.equal(model.pixels[i].vMask & bit, 0);
});

test('createBitFreeViewPromoter: distinct views get distinct bits (no reuse)', () => {
  const model = makeModel();
  const promote = createBitFreeViewPromoter(model, { metaDirty: false });
  const a = promote('PORTSIDE');
  const b = promote('TAIL');
  assert.notEqual(a.bit, b.bit, 'two promoted views must not collide on a bit');
});

test('createBitFreeViewPromoter: a name with no member entry throws (cannot locate pixels)', () => {
  const model = makeModel();
  const promote = createBitFreeViewPromoter(model, { metaDirty: false });
  assert.throws(() => promote('NOPE'), /cannot promote/);
});

// ── END-TO-END through the VENDORED WASM ───────────────────────────

test('e2e: inView() selects EXACTLY the low-word view through the vendored WASM', async () => {
  // 5 pixels. Low-word view PORT = bit 0x100 on pixels [0,1]. The demo
  // pattern lights inView("PORT") red; everything else off.
  const host = new WasmHost();
  await host.init(5);
  try {
    host.setCoords(Array.from({ length: 5 }, () => ({ nx: 0, ny: 0, nz: 0 })));
    const BIT = 0x100;
    host.setPixelMeta([
      { viewMask: BIT }, { viewMask: BIT },
      { viewMask: 0 }, { viewMask: 0 }, { viewMask: 0 },
    ]);
    host.setViewTable({ PORT: { bit: BIT, word: 0 } });

    const src = 'export function render3D(index, x, y, z) {\n' +
      '  if (inView("PORT")) { rgb(1,0,0); } else { rgb(0,0,0); }\n}';
    const compiled = host.compile(src);
    assert.equal(compiled.ok, true, compiled.error);
    host.beginFrame(compiled.handle, 0);
    const buf = host.renderAll6ch(compiled.handle); // 6 bytes/pixel
    const red = (i) => buf[i * 6];

    // EXACTLY pixels 0,1 lit; 2,3,4 dark — zero leak.
    assert.ok(red(0) > 200 && red(1) > 200, 'view members must be lit');
    assert.equal(red(2), 0); assert.equal(red(3), 0); assert.equal(red(4), 0);
    host.destroy(compiled.handle);
  } finally {
    host.shutdown();
  }
});

test('e2e: inView() on a HIGH-word view (inlined literal) selects exactly, zero leak', async () => {
  // pixel 0 in a hi-word view (viewMaskHi bit 0); pixel 1 in a low-word view.
  const host = new WasmHost();
  await host.init(3);
  try {
    host.setCoords(Array.from({ length: 3 }, () => ({ nx: 0, ny: 0, nz: 0 })));
    host.setPixelMeta([
      { viewMask: 0, viewMaskHi: 1 }, // pixel 0: hi view
      { viewMask: 2, viewMaskHi: 0 }, // pixel 1: low view
      { viewMask: 0, viewMaskHi: 0 }, // pixel 2: neither
    ]);
    host.setViewTable({
      HIVIEW: { bit: 1, word: 1 },
      LOVIEW: { bit: 2, word: 0 },
    });
    const src = 'export function render3D(index, x, y, z) {\n' +
      '  rgb(inView("HIVIEW"), inView("LOVIEW"), 0);\n}';
    const compiled = host.compile(src);
    assert.equal(compiled.ok, true, compiled.error);
    host.beginFrame(compiled.handle, 0);
    const buf = host.renderAll6ch(compiled.handle);
    const red = (i) => buf[i * 6], green = (i) => buf[i * 6 + 1];
    // pixel 0: hi view -> red only; pixel 1: low view -> green only; pixel 2 dark.
    assert.ok(red(0) > 200, 'hi view lit'); assert.equal(green(0), 0, 'no leak into low');
    assert.equal(red(1), 0, 'no leak into hi'); assert.ok(green(1) > 200, 'low view lit');
    assert.equal(red(2), 0); assert.equal(green(2), 0);
    host.destroy(compiled.handle);
  } finally {
    host.shutdown();
  }
});

test('e2e: a bit-free view is PROMOTED on demand and then selects exactly', async () => {
  // The full host wiring: a bit-free (Tier-A) pixelIndices view. The
  // promoter allocates a bit, sets it on pixels [1,2], and (because the
  // compile happens BEFORE setPixelMeta) the meta pack carries it. The
  // demo pattern then selects EXACTLY pixels [1,2].
  const host = new WasmHost();
  await host.init(4);
  try {
    const model = {
      pixels: [
        { group: 'A', vMask: 0, viewMask: 0, vMaskHi: 0 },
        { group: 'B', vMask: 0, viewMask: 0, vMaskHi: 0 },
        { group: 'B', vMask: 0, viewMask: 0, vMaskHi: 0 },
        { group: 'C', vMask: 0, viewMask: 0, vMaskHi: 0 },
      ],
      groupBits: { A: 1, B: 2, C: 4 },
      viewMasks: [{ name: 'MIDDLE', pixelIndices: [1, 2], bit: 0 }],
    };
    host.setViewTable({
      A: { bit: 1, word: 0 }, B: { bit: 2, word: 0 }, C: { bit: 4, word: 0 },
      MIDDLE: { bit: 0, word: 0 },
    });
    host.setBitFreeViewPromoter(createBitFreeViewPromoter(model, host));

    const src = 'export function render3D(index, x, y, z) {\n' +
      '  if (inView("MIDDLE")) rgb(0,0,1); else rgb(0,0,0);\n}';
    const compiled = host.compile(src);          // promotes MIDDLE here
    assert.equal(compiled.ok, true, compiled.error);
    assert.equal(host.metaDirty, true, 'promotion must mark meta dirty');

    // Pack meta AFTER compile (mirrors the engine boot order).
    host.setCoords(Array.from({ length: 4 }, () => ({ nx: 0, ny: 0, nz: 0 })));
    host.setPixelMeta(model.pixels.map((px) => ({
      viewMask: px.vMask || 0, viewMaskHi: px.vMaskHi || 0,
    })));
    host.beginFrame(compiled.handle, 0);
    const buf = host.renderAll6ch(compiled.handle);
    const blue = (i) => buf[i * 6 + 2];
    assert.equal(blue(0), 0, 'pixel 0 not in MIDDLE');
    assert.ok(blue(1) > 200 && blue(2) > 200, 'MIDDLE members lit');
    assert.equal(blue(3), 0, 'pixel 3 not in MIDDLE');
    host.destroy(compiled.handle);
  } finally {
    host.shutdown();
  }
});
