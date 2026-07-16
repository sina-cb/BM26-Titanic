// Tests for lib/fixture_type_constants.js — the canonical FIX_* fixture-
// type registry, its stable string→id mapping, the Tier-A viewMask bit
// allocator, and the FIX_* compile-time injector (incl. an e2e check
// through the real MarsinScript compiler).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNTYPED_ID,
  fixtureTypeId,
  roleForId,
  allFixtureRoles,
  presentTypeIds,
  buildFixtureTypeBits,
  injectFixtureConstants,
} from '../../lib/fixture_type_constants.js';
import { WasmHost } from '../../lib/wasm_host.js';

// ── Canonical id mapping (STABLE — append-only, never renumber) ────

test('fixtureTypeId: canonical ids are pinned (renumber = silent re-target)', () => {
  // These ids are the cross-repo ABI contract for the host fixtureTypeId
  // lane. If this test fails because an id MOVED, that is a breaking
  // change — add new ids, never renumber existing ones.
  assert.equal(fixtureTypeId('RawLed'), 1);
  assert.equal(fixtureTypeId('UkingPar'), 2);
  assert.equal(fixtureTypeId('VintageLed'), 3);
  assert.equal(fixtureTypeId('ShehdsBar'), 4);
  assert.equal(fixtureTypeId('ChauvetHaze4D'), 5);
  assert.equal(fixtureTypeId('TEFogMachine'), 6);
});

test('fixtureTypeId: empty string is the RawLed strand marker (additive, not untyped)', () => {
  // titanic ships 480 raw-LED strand pixels as fixtureType ''. They were
  // never targetable before; mapping '' → FIX_RAW_LED is purely additive.
  assert.equal(fixtureTypeId(''), 1);
  assert.equal(fixtureTypeId(null), 1);
  assert.equal(fixtureTypeId(undefined), 1);
});

test('fixtureTypeId: unknown type → UNTYPED (explicit, not a fallback target)', () => {
  assert.equal(fixtureTypeId('NoSuchFixture'), UNTYPED_ID);
  assert.equal(UNTYPED_ID, 0);
});

test('roleForId / allFixtureRoles: role names follow role+count convention', () => {
  assert.equal(roleForId(2), 'FIX_PAR');
  assert.equal(roleForId(3), 'FIX_VINTAGE_6');
  assert.equal(roleForId(4), 'FIX_BAR_18');
  assert.equal(roleForId(0), null);
  assert.ok(allFixtureRoles().includes('FIX_BAR_18'));
});

// ── presentTypeIds ────────────────────────────────────────────────

function pxOf(type) {
  return { fixtureType: type, vMask: 0 };
}

test('presentTypeIds: distinct present ids, UNTYPED excluded', () => {
  const pixels = [pxOf('UkingPar'), pxOf('UkingPar'), pxOf('ShehdsBar'), pxOf('Mystery')];
  const present = presentTypeIds(pixels);
  assert.deepEqual([...present].sort(), [2, 4]);
});

// ── buildFixtureTypeBits (Tier-A allocator) ───────────────────────

test('buildFixtureTypeBits: places fixed bits ABOVE the used mask', () => {
  const pixels = [pxOf('UkingPar'), pxOf('ShehdsBar')];
  // Pretend the model already used bits 0x01..0x80.
  const fb = buildFixtureTypeBits(pixels, 0xFF);
  assert.ok(fb, 'expected Tier-A bits to fit');
  // Par(id2) sorts before Bar(id4): first free bit 0x100, then 0x200.
  assert.equal(fb.table.FIX_PAR, 0x100);
  assert.equal(fb.table.FIX_BAR_18, 0x200);
  assert.equal(fb.bitOf('UkingPar'), 0x100);
  assert.equal(fb.bitOf('ShehdsBar'), 0x200);
  assert.equal(fb.bitOf('NoSuchType'), 0);
});

test('buildFixtureTypeBits: returns null when types do not fit the budget', () => {
  // usedMask already occupies bits up to 0x20000000, leaving only bit 30
  // (0x40000000) free — one bit, but two present types need two.
  const pixels = [pxOf('UkingPar'), pxOf('ShehdsBar')];
  const fb = buildFixtureTypeBits(pixels, 0x3FFFFFFF);
  assert.equal(fb, null);
});

test('buildFixtureTypeBits: no present types → null (nothing to allocate)', () => {
  assert.equal(buildFixtureTypeBits([pxOf('Mystery')], 0), null);
});

// ── injectFixtureConstants ────────────────────────────────────────

const FIX_TABLE = { FIX_PAR: 0x100, FIX_BAR_18: 0x200 };

test('injectFixtureConstants: referenced FIX_* prepended; unknown throws', () => {
  const ok = 'export function render3D(i,x,y,z){ rgb((viewMask & FIX_PAR)!=0, 0, 0); }';
  assert.match(injectFixtureConstants(ok, FIX_TABLE), /^var FIX_PAR = 256;\n/);

  const bad = 'export function render3D(i,x,y,z){ rgb((viewMask & FIX_NOPE)!=0, 0, 0); }';
  assert.throws(() => injectFixtureConstants(bad, FIX_TABLE), /FIX_NOPE.*FIX_PAR/s);
});

// ── End-to-end through the real WASM compiler ─────────────────────

test('WasmHost.compile: FIX_* + MASK_* mix compiles through the real VM', async () => {
  const host = new WasmHost();
  await host.init(2);
  try {
    host.setMaskConstants({ MASK_PARS: 0x20 });
    host.setFixtureConstants({ FIX_PAR: 0x100 });
    const result = host.compile(
      'export function render3D(i,x,y,z){ ' +
      'var byType = (viewMask & FIX_PAR) != 0; ' +
      'var byMask = (viewMask & MASK_PARS) != 0; ' +
      'rgb(byType, byMask, 0); }');
    assert.equal(result.ok, true, result.error);
    host.destroy(result.handle);
  } finally {
    host.shutdown();
  }
});

test('WasmHost.compile: unknown FIX_* is a loud compile failure', async () => {
  const host = new WasmHost();
  await host.init(2);
  try {
    host.setFixtureConstants({ FIX_PAR: 0x100 });
    const result = host.compile(
      'export function render3D(i,x,y,z){ rgb((viewMask & FIX_GHOST)!=0, 0, 0); }');
    assert.equal(result.ok, false);
    assert.match(result.error, /FIX_GHOST/);
  } finally {
    host.shutdown();
  }
});
