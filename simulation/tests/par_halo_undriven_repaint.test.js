/**
 * par_halo_undriven_repaint.test.js — the par-halo leak (operator report
 * 2026-08-06): a par that SHOULD be off kept a lit halo in the sim while the
 * hardware was dark and its SpotLight was off. Intermittent, sACN-in mode.
 *
 * THE MECHANISM (three parts, each individually correct, jointly a leak):
 *
 *   1. sacn_mapper.js paintUndrivenEntry() has a steady-state fast path: once
 *      an entry is marked `_sacnUndriven` and its r/g/b/w/a/u fields already
 *      carry the treatment, it returns WITHOUT calling entry.apply(). That
 *      skip is a pinned perf contract (sacn_mapper.test.js "apply fires once,
 *      not per frame") and it is sound ONLY while nothing else repaints the
 *      fixture meshes behind the entry's back.
 *
 *   2. gui_builder.js's `⚡ Enable` OFF handler paints EVERY par fixture its
 *      config color (default #ffaa44 amber) at full brightness, straight onto
 *      the fixture via setPixelColorRGB — bulb + halo + cone + p.color — an
 *      out-of-band paint the batch entries never see. Meanwhile animate.js's
 *      lighting-disabled clear loop writes entry.r/g/b/w/a/u = 0, which is
 *      byte-identical to the BLACK undriven treatment.
 *
 *   3. Re-enable lighting in sacn_in mode: for every entry still marked
 *      `_sacnUndriven` (unpatched par, or par patched to a universe this
 *      browser holds no frame for) the fast path sees marker + matching
 *      fields and SKIPS the repaint — forever. The fixture keeps the amber
 *      paint: a lit additive halo on an off fixture. The SpotLight pool gates
 *      independently (light_pool.js / analytic_light_gate.js), so the
 *      operator sees a glow with no analytic light — exactly the report.
 *
 * THE FIX: the Enable-OFF handler calls invalidateMarsinBatchCache after its
 * out-of-band paint. The rebuild clones fresh entries (no `_sacnUndriven`
 * marker), so the very next demap pass repaints every undriven fixture with
 * the real treatment (black, or red under "Show Unpatched (Red)").
 *
 * The handler lives inside setupGUI's browser-only closure, so the wiring is
 * pinned by SOURCE CONTRACT — the same tool unpatched_red_two_views.test.js
 * uses for facts a headless test cannot call. The demap-level behaviour
 * (fresh clone ⇒ repaint; marked entry ⇒ skip) is pinned behaviourally below,
 * because that pair is what makes the invalidation both NECESSARY and
 * SUFFICIENT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { demapSacnToPixels } from '../src/dmx/sacn_mapper.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI_BUILDER = readFileSync(
  path.join(HERE, '..', 'src', 'gui', 'gui_builder.js'), 'utf8');

const mockRouter = (frames = {}) => ({ getFullFrame: (u) => frames[u] || null });

function undrivenParEntry() {
  const applied = [];
  return {
    entry: {
      r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
      patch: null, // unpatched — or equivalently patched to a frame-less universe
      channels: { r: 2, g: 3, b: 4, w: 5, a: 6, u: 7 }, // UkingPar 10ch map
      apply: (r, g, b) => applied.push([r, g, b]),
    },
    applied,
  };
}

// ── The bug, at demap level ────────────────────────────────────────────────

test('a marked-undriven entry with matching fields is NOT repainted — the fast path is real', () => {
  // This is the pinned perf contract the leak rode on. If this test ever
  // fails because the fast path was removed, the gui_builder invalidation
  // below becomes redundant (not wrong) — update BOTH together.
  const { entry, applied } = undrivenParEntry();
  const router = mockRouter();
  demapSacnToPixels([entry], router, false); // paints + marks
  assert.equal(applied.length, 1);

  // Out-of-band amber paint happens on the FIXTURE here (invisible to the
  // entry) — e.g. the ⚡ Enable OFF reset. Fields still match the treatment:
  demapSacnToPixels([entry], router, false);
  assert.equal(applied.length, 1,
    'fast path skips apply — without a cache rebuild the fixture would keep ' +
    'the out-of-band paint forever (the par halo leak)');
});

test('a FRESH CLONE of the same entry (what invalidateMarsinBatchCache produces) repaints', () => {
  const { entry, applied } = undrivenParEntry();
  const router = mockRouter();
  demapSacnToPixels([entry], router, false);
  assert.equal(applied.length, 1);

  // animate.js _rebuildBatchCache clones exporter pixels with spread — the
  // private `_sacnUndriven` marker is NOT part of the exporter's pixel shape,
  // so a rebuilt entry arrives unmarked. That is what makes the invalidation
  // in gui_builder a complete cure: next demap pass MUST repaint.
  const rebuilt = [];
  const clone = {
    r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
    patch: entry.patch, channels: entry.channels,
    apply: (r, g, b) => rebuilt.push([r, g, b]),
  };
  demapSacnToPixels([clone], router, false);
  assert.deepEqual(rebuilt, [[0, 0, 0]],
    'a rebuilt (unmarked) entry repaints the fixture black on the next pass');
});

// ── The fix, by source contract ────────────────────────────────────────────

test('the ⚡ Enable OFF reset invalidates the batch cache after its out-of-band paint', () => {
  // Locate the one handler that paints par fixtures to config color when
  // lighting is disabled, and require the invalidation INSIDE it.
  const anchor = GUI_BUILDER.indexOf("'lightingEnabled', sectionConfig.lightingEnabled");
  assert.ok(anchor > 0, 'the ⚡ Enable control must still exist in gui_builder.js');
  const handler = GUI_BUILDER.slice(anchor, GUI_BUILDER.indexOf('updateModeVisibility();', anchor));
  assert.ok(handler.includes('setPixelColorRGB'),
    'the OFF branch still paints fixtures out-of-band (if this moved, move the invalidation with it)');
  assert.ok(handler.includes("invalidateMarsinBatchCache('lighting_disabled_reset')"),
    'the out-of-band paint MUST be followed by a batch-cache invalidation — ' +
    'without it, paintUndrivenEntry\'s fast path preserves the paint forever ' +
    'on every undriven entry (par halo leak, 2026-08-06)');
});
