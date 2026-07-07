// in_view_intrinsic.js — compile-time `inView("Name")` membership fold.
//
// A pattern author may write `inView("PORT")` (or `inView('Bow')`) to test
// whether the pixel currently being rendered belongs to a named in-VM
// view, without hand-managing the MASK_* constant convention or knowing
// which word (viewMask / viewMaskHi) the view's bit lives in. This module
// FOLDS every such call at compile time — before the MarsinScript compiler
// ever runs — into the exact bitwise membership test:
//
//   low-word view  (word 0): inView("X") -> ((viewMask & <bit>) != 0)
//   high-word view (word 1): inView("X") -> ((viewMaskHi & <inlined literal>) != 0)
//
// The high-word mask is emitted as an INLINED single-bit LITERAL (e.g.
// `(viewMaskHi & 1073741824)`), NEVER a `var` — the Tier-C firmware
// rejects a runtime (var) mask on viewMaskHi and requires a compile-time
// single-bit constant (ABI 20260619_1 §0, §5). This mirrors the
// name_id_registry inline-injection discipline.
//
// Resolution is by the view's AUTHORED NAME (the same string the model's
// view registry and `/model/view-selection-options` use), not the
// sanitized MASK_* identifier — so `inView("Front Wall")` works verbatim.
//
// codex P0 — NO fallbacks, fail loudly:
//   - An unknown view name is a hard compile error that lists the known
//     views (never a silent constant-false test).
//   - A BIT-FREE view (a Tier-A auto-view with `bit:0` and no in-VM bit)
//     cannot be tested in-VM by a raw bit. It is PROMOTED to an in-VM bit
//     ON DEMAND via the `promote` callback (the host allocates a free
//     (word,bit) from the Tier-C two-word 62-bit budget and SETS that bit
//     on the view's member pixels so the test is correct at runtime). If
//     no promoter is wired, or the budget is exhausted, the promoter
//     throws loudly — `inView` NEVER silently folds a bit-free view to a
//     constant true/false.

import { ViewBitAllocator } from './view_word.js';

// MarsinScript comment stripper (// line and /* block */), shared with the
// name_id_registry scanner: a commented-out `inView("X")` must neither
// fold nor fail the compile.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

// Match `inView("Name")` / `inView('Name')` with optional surrounding
// whitespace. The name is any run that is not the matching quote — view
// names allow letters, digits, spaces, underscores, dashes and the typed-
// view '@' prefix, none of which is a quote, so a non-greedy "not a quote"
// capture is exact. Whole-token `inView` (`\binView\b`) so it never trips
// on a longer identifier (e.g. `myInView`).
const IN_VIEW_RE = /\binView\s*\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g;

/**
 * Fold every `inView("Name")` call in `source` to its bitwise membership
 * test, resolving names against `viewTable` (and promoting bit-free views
 * on demand via `promote`). Returns the source unchanged when it contains
 * no `inView(...)` call.
 *
 * @param {string} source
 * @param {Object<string, {bit: number, word: 0|1}>} viewTable
 *        AUTHORED-name -> { bit, word } for every named in-VM view. `bit`
 *        may be 0 for a bit-free (Tier-A) view; such a view is promoted on
 *        demand (see `promote`).
 * @param {(name: string) => {bit: number, word: 0|1}} [promote]
 *        Optional host hook that allocates an in-VM bit for a bit-free view
 *        (sets the bit on its member pixels host-side) and returns the new
 *        { bit, word }. Required only if the source tests a bit-free view.
 * @returns {string}
 */
export function injectInViewIntrinsic(source, viewTable, promote = null) {
  const table = viewTable || {};
  const code = stripComments(source);
  // Collect the distinct view names referenced in non-comment code first,
  // so an unknown / un-promotable name fails BEFORE any substitution and
  // the error can list every offender deterministically.
  IN_VIEW_RE.lastIndex = 0;
  let m;
  const referenced = new Set();
  while ((m = IN_VIEW_RE.exec(code)) !== null) {
    referenced.add(m[2]);
  }
  if (referenced.size === 0) return source;

  // Resolve each referenced name to { bit, word }, promoting bit-free
  // views on demand. Resolution is cached so a name used twice promotes
  // exactly once (one bit, not two).
  const unknown = [];
  const resolved = new Map(); // name -> { bit, word }
  for (const name of referenced) {
    const entry = table[name];
    if (entry === undefined) {
      unknown.push(name);
      continue;
    }
    let bit = entry.bit;
    let word = entry.word === 1 ? 1 : 0;
    if (!Number.isInteger(bit) || bit === 0) {
      // Bit-free (Tier-A) view: promote it to an in-VM bit on demand. No
      // promoter, or a promoter that throws, is a LOUD failure — never a
      // silent constant test.
      if (typeof promote !== 'function') {
        throw new Error(`inView("${name}") targets a bit-free (host-only) view with no in-VM bit, ` +
          `and no on-demand bit allocator is wired. Give the view an in-VM bit (a pinned ` +
          `viewMasks entry with an explicit single-bit value), or enable on-demand promotion.`);
      }
      const promoted = promote(name);
      if (!promoted || !Number.isInteger(promoted.bit) || promoted.bit === 0 ||
          (promoted.word !== 0 && promoted.word !== 1)) {
        throw new Error(`inView("${name}"): on-demand bit promotion returned an invalid ` +
          `{bit, word} (${JSON.stringify(promoted)}) — refusing to fold to a silent constant test.`);
      }
      bit = promoted.bit;
      word = promoted.word;
    }
    resolved.set(name, { bit, word });
  }
  if (unknown.length > 0) {
    const known = Object.keys(table);
    throw new Error(`Pattern references unknown view(s) via inView(): ${unknown.join(', ')}. ` +
      `Known views for this model: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }

  // Rewrite the ORIGINAL source. Only call sites whose name resolved (i.e.
  // appeared in NON-comment code) are folded; a name that occurs solely
  // inside a comment was never added to `resolved`, so its (comment-only)
  // occurrence is left verbatim — it is not an active test and must not
  // fold or fail. This mirrors name_id_registry's whole-source rewrite.
  return source.replace(IN_VIEW_RE, (full, _q, name) => {
    const r = resolved.get(name);
    if (!r) return full; // comment-only occurrence — leave untouched
    if (r.word === 1) {
      // High word: the mask MUST be an inlined single-bit literal.
      return `((viewMaskHi & ${r.bit}) != 0)`;
    }
    return `((viewMask & ${r.bit}) != 0)`;
  });
}

/**
 * Build the on-demand bit-free-view promoter the host hands to
 * `injectInViewIntrinsic`. It owns a two-word ViewBitAllocator seeded with
 * every bit ALREADY in use by the model (group bits + every preset/auto-view
 * that carries a real bit, per word), so a freshly allocated bit can never
 * collide with an existing one. When `inView("Name")` first tests a bit-free
 * (Tier-A) view, this:
 *   1. allocates the lowest free (word, bit) from the 62-bit budget
 *      (word 0 fills before word 1 — exhaustion throws LOUDLY),
 *   2. SETS that bit on the view's member pixels (by `groups` or
 *      `pixelIndices`) in BOTH the abbrev (`vMask`/`vMaskHi`) and full
 *      (`viewMask`) keys so the next meta pack carries it,
 *   3. updates the view entry's `bit`/`word` (so a second inView on the
 *      same view reuses the bit, and the entry's membership stays in sync),
 *   4. raises `host.metaDirty` so the caller re-packs the meta buffer
 *      before rendering.
 * Returns { bit, word }.
 *
 * @param {{ pixels: Array, viewMasks: Array, groupBits?: Object }} model
 * @param {{ metaDirty?: boolean }} host  the WasmHost (metaDirty is flipped)
 * @returns {(name: string) => { bit: number, word: 0|1 }}
 */
export function createBitFreeViewPromoter(model, host) {
  if (!model || !Array.isArray(model.pixels) || !Array.isArray(model.viewMasks)) {
    throw new Error('createBitFreeViewPromoter requires a model with pixels[] and viewMasks[]');
  }
  // Seed the allocator with every bit already claimed, per word.
  const alloc = new ViewBitAllocator();
  for (const bit of Object.values(model.groupBits || {})) {
    if (Number.isInteger(bit) && bit > 0 && !alloc.isUsed(0, bit)) alloc.claim(0, bit, 'group');
  }
  for (const vm of model.viewMasks) {
    if (!vm || !Number.isInteger(vm.bit) || vm.bit === 0) continue;
    const word = vm.word === 1 ? 1 : 0;
    if (!alloc.isUsed(word, vm.bit)) alloc.claim(word, vm.bit, `view '${vm.name}'`);
  }
  const byName = new Map(model.viewMasks.map(vm => [vm.name, vm]));

  return function promote(name) {
    const vm = byName.get(name);
    if (!vm) {
      // Not a registered preset/auto-view (e.g. a base GROUP, which is
      // always bit-backed and never reaches here). A bit-free view that is
      // not in viewMasks cannot have its members located — fail loudly.
      throw new Error(`inView("${name}"): cannot promote — no view-mask entry with member pixels found ` +
        `for this name. Only bit-free presets/auto-views (groups[] or pixelIndices[]) are promotable.`);
    }
    const { word, bit } = alloc.next(`inView promotion of '${name}'`);

    // Set the bit on the view's member pixels (and mirror to the full key).
    const setOnPixel = (px) => {
      if (!px) return;
      if (word === 1) {
        px.vMaskHi = (px.vMaskHi ?? 0) | bit;
      } else {
        const cur = (px.vMask ?? px.viewMask ?? 0) | bit;
        px.vMask = cur;
        px.viewMask = cur;
      }
    };
    if (Array.isArray(vm.groups) && vm.groups.length > 0) {
      const groupSet = new Set(vm.groups);
      for (const px of model.pixels) if (px && groupSet.has(px.group)) setOnPixel(px);
    } else if (Array.isArray(vm.pixelIndices) && vm.pixelIndices.length > 0) {
      for (const idx of vm.pixelIndices) setOnPixel(model.pixels[idx]);
    } else {
      throw new Error(`inView("${name}"): the view has neither groups[] nor pixelIndices[] membership — ` +
        `cannot set its in-VM bit on any pixel.`);
    }

    // Pin the freshly allocated bit/word on the entry so a repeat inView
    // reuses it and the model stays internally consistent.
    vm.bit = bit;
    vm.word = word;
    if (host) host.metaDirty = true;
    return { bit, word };
  };
}
