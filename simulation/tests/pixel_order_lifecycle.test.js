/**
 * pixel_order_lifecycle.test.js — Mechanism A's LIFECYCLE (design contract
 * 20260806_174 §2.3–§2.8): what happens to a pixel-order flag when the operator
 * grows, shrinks, renames, deletes or renumbers a generator group, and what the
 * GUI must offer while he does it.
 *
 * Two halves:
 *  • BEHAVIOUR — the grow/shrink arithmetic is reproduced from the pure store
 *    helpers exactly as gui_builder computes it at the regeneration casualty
 *    site (kept in lockstep by the source assertions below);
 *  • SOURCE CONTRACT — the rest lives only inside the browser closure
 *    (`setupGUI`), so it is pinned by text scanning, the same honest tool
 *    orphan_removal_wiring.test.js / rename_hygiene_wiring.test.js use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  carryPixelOrderEntries, clearCasualtyPixelOrder,
} from '../src/dmx/pixel_order_store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const GUI = read('src', 'gui', 'gui_builder.js');
const CONFIG = read('src', 'core', 'config.js');

/**
 * The brace-matched block that follows `marker`. When the marker ends in `(`
 * (a function signature) the parameter list is skipped first, so a default value
 * like `options = {}` cannot be mistaken for the body.
 */
function bodyAfter(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `${marker}: not found`);
  let i = at + marker.length;
  if (marker.endsWith('(')) {
    let paren = 1;
    while (paren > 0 && i < source.length) {
      if (source[i] === '(') paren++;
      else if (source[i] === ')') paren--;
      i++;
    }
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let k = open; k < source.length; k++) {
    if (source[k] === '{') depth++;
    else if (source[k] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, k + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${marker}`);
}

/** Body of `function <name>(` in `source`. */
const functionBody = (source, name) => bodyAfter(source, `function ${name}(`);

// ── BEHAVIOUR: grow preserves, shrink clears ──────────────────────────────
//
// gui_builder computes `survivingNames = {`<group> 1` … `<group> N`}` for the
// NEW count and calls the clear-and-warn helper with the casualties. This
// reproduces that arithmetic against the pure helper.

function regenerate(store, group, oldCount, newCount) {
  const surviving = new Set();
  for (let n = 1; n <= newCount; n++) surviving.add(`${group} ${n}`);
  const casualties = [];
  for (let n = 1; n <= oldCount; n++) {
    const name = `${group} ${n}`;
    if (!surviving.has(name)) casualties.push(name);
  }
  return clearCasualtyPixelOrder(store, casualties);
}

test('GROW 4→5: the flip on member 3 is preserved and the new member is NORMAL', () => {
  const store = { 'Wall 3': 'reversed' };
  const cleared = regenerate(store, 'Wall', 4, 5);
  assert.deepEqual(cleared, [], 'a grow has no casualties, so nothing is cleared');
  assert.deepEqual(store, { 'Wall 3': 'reversed' });
  // "Wall 5" has no entry at all — absence IS normal, no key is written.
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'Wall 5'), false);
});

test('SHRINK 4→2: flags on the removed members are cleared and reported by name', () => {
  const store = { 'Wall 1': 'reversed', 'Wall 3': 'reversed', 'Wall 4': 'reversed' };
  const cleared = regenerate(store, 'Wall', 4, 2);
  assert.deepEqual(cleared.map((c) => c.name), ['Wall 3', 'Wall 4']);
  assert.deepEqual(store, { 'Wall 1': 'reversed' },
    'the survivor keeps its flag; the casualties do not linger to resurrect on regrow');
});

test('SHRINK then REGROW: the cleared members come back NORMAL, never resurrected', () => {
  const store = { 'Wall 3': 'reversed' };
  regenerate(store, 'Wall', 4, 2);
  regenerate(store, 'Wall', 2, 4);
  assert.deepEqual(store, {}, 'a brand-new physical light must not inherit an old flip');
});

test('RENAME then regenerate: the carry runs FIRST, so the sweep clears nothing', () => {
  const store = { 'Wall 3': 'reversed' };
  carryPixelOrderEntries(store, 'Wall', 'Bow', 4);
  // The regeneration that follows a rename sweeps the OLD name — every old-named
  // fixture is a casualty. Because the carry already moved the entries, nothing
  // is cleared and the operator sees no spurious "flags were cleared" warning.
  const cleared = regenerate(store, 'Wall', 4, 0);
  assert.deepEqual(cleared, []);
  assert.deepEqual(store, { 'Bow 3': 'reversed' });
});

// ── SOURCE CONTRACT: the store is wired in, not re-derived ────────────────

test('gui_builder imports the pure store instead of hand-rolling the rule', () => {
  assert.match(GUI, /from "\.\.\/dmx\/pixel_order_store\.js"/);
  for (const sym of ['isReversed', 'carryPixelOrderEntries', 'clearCasualtyPixelOrder',
    'casualtyClearMessage', 'reversedMembers', 'validatePixelOrderStore']) {
    assert.match(GUI, new RegExp(`\\b${sym}\\b`), `${sym} must be imported and used`);
  }
  // The enum string is never ASSIGNED by hand in the GUI (one vocabulary).
  assert.equal(/=\s*['"]reversed['"]/.test(GUI), false,
    "the GUI must write PIXEL_ORDER_REVERSED, never a literal 'reversed'");
});

test('config.js persists the store with the groupOverrides idiom (intercept + prune)', () => {
  assert.match(CONFIG, /from "\.\.\/dmx\/pixel_order_store\.js"/);
  // Load intercept BEFORE the generic { value } recursion.
  const interceptAt = CONFIG.indexOf('key === "pixelOrder"');
  const recursionAt = CONFIG.indexOf('const entry = node[key];');
  assert.ok(interceptAt !== -1 && interceptAt < recursionAt,
    'the pixelOrder map must be intercepted before the { value } recursion mangles it');
  // Prune on persist, and DELETE the key when nothing is reversed.
  assert.match(CONFIG, /const pixelOrderClean = prunePixelOrder\(params\.pixelOrder\);/);
  assert.match(CONFIG, /delete node\.pixelOrder;/);
  assert.match(CONFIG, /node\[key\] = prunePixelOrder\(params\.pixelOrder\);/);
});

// ── The clear-and-warn helper: one path, one message shape (§2.3) ─────────

test('the casualty helper clears via the pure module and warns to BOTH channels', () => {
  const body = functionBody(GUI, 'clearPixelOrderCasualties');
  assert.match(body, /clearCasualtyPixelOrder\(params\.pixelOrder, casualtyNames\)/);
  assert.match(body, /casualtyClearMessage\(/);
  assert.match(body, /console\.warn\(/);
  assert.match(body, /showToast\(message, \{ ttl: 14000 \}\)/,
    'the toast TTL matches the resnap warning the operator already knows');
  assert.match(body, /if \(cleared\.length === 0\) return \[\];/,
    'no casualties carrying a flag = no noise');
});

test('BOTH sweep sites route through that one helper (regeneration + group delete)', () => {
  const calls = [...GUI.matchAll(/clearPixelOrderCasualties\(/g)];
  // 1 definition + 2 call sites.
  assert.equal(calls.length, 3, 'exactly two call sites plus the definition');
  assert.match(GUI, /clearPixelOrderCasualties\(groupName, regenCasualties\.map\(\(c\) => c\.name\)\)/);
  assert.match(GUI, /clearPixelOrderCasualties\(groupName, removedConfigs\.map\(\(c\) => c\.name\)\)/);
});

// ── Rename carry (§2.4) ──────────────────────────────────────────────────

test('the rename carries pixel-order entries beside the group override, before regen', () => {
  const overrideAt = GUI.indexOf('carryTraceGroupOverride(params.groupOverrides');
  const carryAt = GUI.indexOf('carryPixelOrderEntries(');
  const regenAt = GUI.indexOf('if (trace.generated) generateGroupFromTrace(i, true, oldGroupName);');
  assert.ok(overrideAt !== -1 && carryAt !== -1 && regenAt !== -1);
  assert.ok(overrideAt < carryAt, 'the pixel-order carry sits with the other name-keyed carries');
  assert.ok(carryAt < regenAt,
    'the carry must run BEFORE the regenerate, or the sweep would clear the flags');
  assert.match(GUI,
    /carryPixelOrderEntries\(\s*params\.pixelOrder, oldGroupName, newName, traceLightCount\(trace\)\)/);
});

// ── Swap start/end: NAME-STUCK, with the dialog extended (§2.5) ───────────

test('confirmRenumber lists pixel-order flags among what stays put', () => {
  const body = bodyAfter(GUI, 'const confirmRenumber = () =>');
  assert.match(body, /pixel-order flags \(NORMAL\/REVERSED\)/);
  assert.match(body, /Currently REVERSED: \$\{reversedNames\.join\(', '\)\}/);
  assert.match(body, /reversedMembers\(params\.pixelOrder, memberNames\)/);
  // The dialog still says the addresses/ids/anchors stay put — one rule.
  assert.match(body, /EVERYTHING KEYED ON THE NAME STAYS PUT/);
});

test('the Swap handler MOVES no pixel-order entry — the flags are name-stuck', () => {
  const at = GUI.indexOf('swapBtn.onclick');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, GUI.indexOf('swapRow.appendChild(swapBtn);', at));
  assert.equal(/pixelOrder/.test(body), false,
    'a Swap renumbers names; every name-keyed store, pixel order included, stays put');
  assert.match(body, /confirmRenumber\(\)/, 'and it still asks first');
});

// ── The per-fixture toggle (§2.8) ─────────────────────────────────────────

test('the toggle is rendered ONLY for definitions with more than one pixel', () => {
  assert.match(GUI, /const defPixelCount = \(fDef && Array\.isArray\(fDef\.pixels\)\) \? fDef\.pixels\.length : 0;/);
  assert.match(GUI, /if \(genChildren && defPixelCount > 1\) \{/,
    'pars must never see the control');
});

test('the toggle writes the enum / deletes the key, saves, and says where it lands', () => {
  const at = GUI.indexOf('pxOrderBtn.onclick');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, GUI.indexOf('pxOrderRow.appendChild(pxOrderBtn);', at));
  assert.match(body, /delete params\.pixelOrder\[config\.name\];/,
    'NORMAL is the absence of a key, never a stored default');
  assert.match(body, /params\.pixelOrder\[config\.name\] = PIXEL_ORDER_REVERSED;/);
  assert.match(body, /debounceAutoSave\(\)/);
  assert.match(body, /Reload the model\/pattern on the engine/,
    'the preview deliberately does not change, so the toast must say where the effect lands');
  assert.match(body, /alert\(err\.message\)/,
    'an invalid stored value is surfaced, never guessed at');
});

test('the button paints a visible NORMAL / REVERSED status', () => {
  assert.match(GUI, /'Px ⇄ REVERSED'/);
  assert.match(GUI, /'Px →'/);
  assert.match(GUI, /Verify with calibration pattern 71/);
});

// ── GC: loud, never silent, never automatic (§2.7) ────────────────────────

test('boot validation runs AFTER the trace auto-regeneration', () => {
  const regenAt = GUI.indexOf('// Auto-generate par lights for traces marked as already generated');
  const validateAt = GUI.indexOf("reportPixelOrderStore('boot')");
  assert.ok(regenAt !== -1 && validateAt !== -1);
  assert.ok(regenAt < validateAt,
    'validating before the regenerate would report every generated fixture as missing');
});

test('every save reports the store too, and the export refuses an invalid one', () => {
  const body = functionBody(GUI, 'exportConfig');
  const reportAt = body.indexOf("reportPixelOrderStore('save')");
  const modelAt = body.indexOf('saveModelJS();');
  assert.ok(reportAt !== -1 && modelAt !== -1 && reportAt < modelAt);
  // The universe gate still runs ahead of everything (subscribed_universes.test.js
  // pins that too — this keeps the new call from being slipped in front of it).
  assert.ok(body.indexOf('checkSubscribedUniversesBeforeSave') < reportAt);
});

test('stale entries are never auto-deleted — only an explicit, listed gesture removes them', () => {
  assert.match(GUI, /🧹 Clear stale pixel-order entries \(\$\{staleOrder\.length\}\)/);
  const at = GUI.indexOf('staleBtn.onclick');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, GUI.indexOf('autoPatchWrap.appendChild(staleBtn);', at));
  assert.match(body, /confirm\(/, 'the names are listed and confirmed before anything is deleted');
  assert.match(body, /for \(const name of staleOrder\) delete params\.pixelOrder\[name\];/);
  assert.match(body, /debounceAutoSave\(\)/);
  // The reporting pass itself never mutates the store.
  const report = functionBody(GUI, 'reportPixelOrderStore');
  assert.equal(/delete /.test(report), false, 'the validator must not GC anything on its own');
});

test('the panel-render census is QUIET while the boot/save pass is LOUD', () => {
  const quiet = functionBody(GUI, 'pixelOrderStaleNames');
  assert.equal(/showToast\(/.test(quiet), false,
    'renderParGUI runs constantly — it must not toast on every render');
  const loud = functionBody(GUI, 'reportPixelOrderStore');
  assert.match(loud, /console\.warn\(/);
  assert.match(loud, /showToast\(/);
});
