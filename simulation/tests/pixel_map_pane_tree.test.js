import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, leaf, isLeaf, isSplit, getNode, leafPaths, firstLeaf,
  splitPane, closePane, setRatio, bindView, toggleZoom,
  cycleFocus, moveFocus, resizeFocused,
  computeLayout, serialize, deserialize,
  saveLayout, loadLayout, clearLayout,
  RATIO_MIN, RATIO_MAX, STORAGE_PREFIX,
} from '../src/gui/pixel_map/pixel_map_pane_tree.js';

// Pins the pure split-tree model for the 2D Pixel Map multiview (design §2.3).
// Everything here is pure data — no DOM, no canvas.

// ── Construction + node helpers ───────────────────────────────────────────

test('createState is a single focused leaf, no zoom', () => {
  const s = createState('top_down');
  assert.deepEqual(s, { root: { view: 'top_down' }, focus: '', zoom: null });
  assert.ok(isLeaf(s.root));
  assert.equal(isSplit(s.root), false);
});

test('getNode walks a/b paths and rejects overruns', () => {
  const s = splitPane(createState('v'), '', 'v');   // root → {a:leaf, b:leaf}
  assert.ok(isSplit(getNode(s.root, '')));
  assert.ok(isLeaf(getNode(s.root, 'a')));
  assert.ok(isLeaf(getNode(s.root, 'b')));
  assert.equal(getNode(s.root, 'aa'), null);        // past a leaf
  assert.equal(getNode(s.root, 'c'), null);         // bad char
});

test('leafPaths lists leaves left/top → right/bottom', () => {
  let s = createState('x');
  s = splitPane(s, '', 'v');       // a | b
  s = splitPane(s, 'a', 'h');      // aa/ab | b
  assert.deepEqual(leafPaths(s.root), ['aa', 'ab', 'b']);
});

test('firstLeaf always descends into a', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = splitPane(s, 'a', 'v');
  assert.equal(firstLeaf(s.root), 'aa');
  assert.equal(firstLeaf(s.root, 'b'), 'b');
});

// ── splitPane ─────────────────────────────────────────────────────────────

test('splitPane replaces the leaf with a 0.5 split, new sibling inherits view, focus → b', () => {
  const s = splitPane(createState('top_down'), '', 'v');
  assert.equal(s.root.split, 'v');
  assert.equal(s.root.ratio, 0.5);
  assert.equal(s.root.a.view, 'top_down');
  assert.equal(s.root.b.view, 'top_down');   // new pane inherits focused view
  assert.equal(s.focus, 'b');
  assert.equal(s.zoom, null);
});

test('splitPane clears an active zoom (structural change)', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = toggleZoom(s, 'a');
  assert.equal(s.zoom, 'a');
  s = splitPane(s, 'a', 'h');
  assert.equal(s.zoom, null);
});

test('splitPane on a non-leaf throws', () => {
  const s = splitPane(createState('x'), '', 'v');
  assert.throws(() => splitPane(s, '', 'v'), /not a leaf/);
});

test('splitPane rejects a bad direction', () => {
  assert.throws(() => splitPane(createState('x'), '', 'z'), /bad dir/);
});

test('splitPane is pure — original state is untouched', () => {
  const s0 = createState('x');
  const s1 = splitPane(s0, '', 'v');
  assert.ok(isLeaf(s0.root));           // original still a leaf
  assert.notEqual(s0, s1);
});

// ── closePane ─────────────────────────────────────────────────────────────

test('closePane on the last pane is a no-op (same reference)', () => {
  const s = createState('x');
  assert.equal(closePane(s, ''), s);
});

test('closePane collapses the sibling up into the parent slot', () => {
  let s = splitPane(createState('a1'), '', 'v');   // a=a1, b=a1; focus b
  s = bindView(s, 'b1', 'b');                       // b now shows b1
  s = closePane(s, 'b');                            // close b → a collapses up
  assert.ok(isLeaf(s.root));
  assert.equal(s.root.view, 'a1');
  assert.equal(s.focus, '');
});

test('closePane remaps focus that lived under the kept sibling', () => {
  // root split; a is itself split (aa, ab); close b → a's subtree moves to root.
  let s = splitPane(createState('x'), '', 'v');
  s = splitPane(s, 'a', 'v');            // aa | ab | b   (focus 'ab')
  s = bindView(s, 'keep', 'ab');
  s = closePane(s, 'b');                 // keep subtree (aa/ab) shifts to root a/b
  assert.deepEqual(leafPaths(s.root), ['a', 'b']);
  assert.equal(getNode(s.root, 'b').view, 'keep');   // 'ab' → 'b'
  assert.equal(s.focus, 'b');
});

test('closePane whose removed subtree held focus falls back to a valid leaf', () => {
  let s = splitPane(createState('x'), '', 'v');   // focus 'b'
  s = splitPane(s, 'b', 'v');                      // ba | bb, focus 'bb'
  // Close the whole 'b' branch (which contains focus) → 'a' collapses to root.
  s = closePane(s, 'b');
  assert.ok(isLeaf(s.root));
  assert.equal(s.focus, '');
  assert.ok(isLeaf(getNode(s.root, s.focus)));
});

test('closePane clears zoom when the zoomed pane is removed', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = toggleZoom(s, 'b');
  s = closePane(s, 'b');
  assert.equal(s.zoom, null);
});

// ── setRatio ──────────────────────────────────────────────────────────────

test('setRatio updates a split and clamps to [0.15, 0.85]', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = setRatio(s, '', 0.3);
  assert.equal(getNode(s.root, '').ratio, 0.3);
  assert.equal(setRatio(s, '', 0.01).root.ratio, RATIO_MIN);
  assert.equal(setRatio(s, '', 0.99).root.ratio, RATIO_MAX);
});

test('setRatio on a leaf throws', () => {
  assert.throws(() => setRatio(createState('x'), '', 0.4), /not a split/);
});

// ── bindView ──────────────────────────────────────────────────────────────

test('bindView swaps a leaf view and leaves siblings alone', () => {
  let s = splitPane(createState('a1'), '', 'v');
  s = bindView(s, 'b1', 'b');
  assert.equal(getNode(s.root, 'a').view, 'a1');
  assert.equal(getNode(s.root, 'b').view, 'b1');
});

test('bindView defaults to the focused pane', () => {
  let s = splitPane(createState('a1'), '', 'v');   // focus 'b'
  s = bindView(s, 'zz');
  assert.equal(getNode(s.root, 'b').view, 'zz');
});

test('bindView on a split path throws', () => {
  const s = splitPane(createState('x'), '', 'v');
  assert.throws(() => bindView(s, 'y', ''), /not a leaf/);
});

// ── toggleZoom ────────────────────────────────────────────────────────────

test('toggleZoom sets then clears', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = toggleZoom(s, 'a');
  assert.equal(s.zoom, 'a');
  s = toggleZoom(s, 'a');
  assert.equal(s.zoom, null);
});

test('toggleZoom on a non-leaf throws', () => {
  const s = splitPane(createState('x'), '', 'v');
  assert.throws(() => toggleZoom(s, ''), /not a leaf/);
});

// ── Focus movement ────────────────────────────────────────────────────────

test('cycleFocus wraps forward and backward', () => {
  let s = splitPane(createState('x'), '', 'v');   // a | b, focus b
  s = splitPane(s, 'a', 'v');                      // aa | ab | b, focus ab
  const order = leafPaths(s.root);                 // ['aa','ab','b']
  s = { ...s, focus: 'aa' };
  assert.equal(cycleFocus(s, 1).focus, 'ab');
  assert.equal(cycleFocus(s, -1).focus, 'b');      // wrap to end
  assert.equal(cycleFocus({ ...s, focus: 'b' }, 1).focus, 'aa'); // wrap to start
});

test('cycleFocus on a single pane is a no-op', () => {
  const s = createState('x');
  assert.equal(cycleFocus(s, 1), s);
});

test('moveFocus picks the geometric neighbor', () => {
  // Vertical split: a = left half, b = right half.
  let s = splitPane(createState('x'), '', 'v');
  s = { ...s, focus: 'a' };
  assert.equal(moveFocus(s, 'right').focus, 'b');
  assert.equal(moveFocus(s, 'left').focus, 'a');   // nothing further left → unchanged
  assert.equal(moveFocus({ ...s, focus: 'b' }, 'left').focus, 'a');
  assert.equal(moveFocus(s, 'up').focus, 'a');      // no vertical neighbor
});

test('moveFocus navigates a nested grid', () => {
  // Top-level v-split; left column further split h into aa(top)/ab(bottom).
  let s = splitPane(createState('x'), '', 'v');
  s = splitPane(s, 'a', 'h');                       // aa top-left, ab bottom-left, b right
  assert.equal(moveFocus({ ...s, focus: 'aa' }, 'down').focus, 'ab');
  assert.equal(moveFocus({ ...s, focus: 'ab' }, 'up').focus, 'aa');
  assert.equal(moveFocus({ ...s, focus: 'aa' }, 'right').focus, 'b');
});

// ── resizeFocused ─────────────────────────────────────────────────────────

test('resizeFocused grows the focused pane via the divider on the requested side', () => {
  let s = splitPane(createState('x'), '', 'v');    // a | b, ratio 0.5
  // Focus a (left). Growing right moves the shared divider right → ratio up.
  s = { ...s, focus: 'a' };
  const grown = resizeFocused(s, 'right', 0.1);
  assert.ok(getNode(grown.root, '').ratio > 0.5);
  // Focus b (right). Growing right pushes into... nothing (b is at right edge).
  const noop = resizeFocused({ ...s, focus: 'b' }, 'right', 0.1);
  assert.equal(getNode(noop.root, '').ratio, 0.5);
  // Focus b growing left grows b → ratio (a's share) decreases.
  const bLeft = resizeFocused({ ...s, focus: 'b' }, 'left', 0.1);
  assert.ok(getNode(bLeft.root, '').ratio < 0.5);
});

test('resizeFocused is a no-op when no matching divider exists', () => {
  const s = createState('x');
  assert.equal(resizeFocused(s, 'left', 0.1), s);
});

// ── computeLayout ─────────────────────────────────────────────────────────

test('computeLayout tiles a v-split by ratio (no divider gap)', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = setRatio(s, '', 0.25);
  const { panes, dividers } = computeLayout(s, 1000, 400, 0);
  const a = panes.find((p) => p.path === 'a');
  const b = panes.find((p) => p.path === 'b');
  assert.deepEqual([a.x, a.w], [0, 250]);
  assert.deepEqual([b.x, b.w], [250, 750]);
  assert.equal(a.h, 400);
  assert.equal(dividers.length, 1);
  assert.equal(dividers[0].dir, 'v');
});

test('computeLayout honors divider thickness', () => {
  const s = splitPane(createState('x'), '', 'v');   // ratio 0.5
  const { panes } = computeLayout(s, 1000, 400, 6);
  const a = panes.find((p) => p.path === 'a');
  const b = panes.find((p) => p.path === 'b');
  assert.equal(a.w, 500 - 3);
  assert.equal(b.x, 500 + 3);
  assert.equal(b.w, 500 - 3);
});

test('computeLayout with zoom returns only the zoomed pane full-bleed', () => {
  let s = splitPane(createState('x'), '', 'v');
  s = toggleZoom(s, 'a');
  const { panes, dividers } = computeLayout(s, 800, 600);
  assert.equal(panes.length, 1);
  assert.deepEqual(
    { path: panes[0].path, x: panes[0].x, y: panes[0].y, w: panes[0].w, h: panes[0].h },
    { path: 'a', x: 0, y: 0, w: 800, h: 600 },
  );
  assert.equal(dividers.length, 0);
});

// ── serialize / deserialize ───────────────────────────────────────────────

test('serialize → deserialize round-trips a nested tree', () => {
  let s = splitPane(createState('top_down'), '', 'v');
  s = bindView(s, 'front', 'b');
  s = splitPane(s, 'a', 'h');
  s = bindView(s, 'strands', 'aa');
  s = bindView(s, 'te_sign', 'ab');
  s = { ...s, focus: 'ab' };
  const snap = serialize(s);
  const back = deserialize(snap, ['top_down', 'front', 'strands', 'te_sign']);
  assert.deepEqual(back, s);
  // Snapshot is a deep clone — mutating it does not touch the live state.
  snap.root.a.a.view = 'MUTATED';
  assert.equal(getNode(s.root, 'aa').view, 'strands');
});

test('deserialize rejects an unknown viewId', () => {
  const snap = serialize(bindView(splitPane(createState('a'), '', 'v'), 'ghost', 'b'));
  assert.throws(() => deserialize(snap, ['a']), /unknown view 'ghost'/);
});

test('deserialize accepts any view when validViewIds is null', () => {
  const snap = serialize(bindView(splitPane(createState('a'), '', 'v'), 'ghost', 'b'));
  assert.doesNotThrow(() => deserialize(snap, null));
});

test('deserialize rejects a bad split, bad ratio, missing node', () => {
  assert.throws(() => deserialize({ root: { split: 'x', ratio: 0.5, a: leaf('v'), b: leaf('v') }, focus: 'a', zoom: null }), /bad split/);
  assert.throws(() => deserialize({ root: { split: 'v', ratio: 2, a: leaf('v'), b: leaf('v') }, focus: 'a', zoom: null }), /bad ratio/);
  assert.throws(() => deserialize({ root: { split: 'v', ratio: 0.5, a: leaf('v') }, focus: 'a', zoom: null }), /missing/);
});

test('deserialize rejects a focus/zoom that is not a leaf', () => {
  const good = serialize(splitPane(createState('v'), '', 'v'));
  assert.throws(() => deserialize({ ...good, focus: '' }), /focus '' is not a leaf/);
  assert.throws(() => deserialize({ ...good, zoom: '' }), /zoom '' is not a leaf/);
  assert.throws(() => deserialize({ ...good, focus: 'zzz' }), /is not a leaf/);
});

test('deserialize clamps an out-of-range-but-valid ratio', () => {
  const back = deserialize({ root: { split: 'v', ratio: 0.9, a: leaf('v'), b: leaf('v') }, focus: 'a', zoom: null });
  assert.equal(back.root.ratio, RATIO_MAX);
});

test('deserialize rejects non-object input', () => {
  assert.throws(() => deserialize(null), /not an object/);
  assert.throws(() => deserialize('nope'), /not an object/);
});

// ── Persistence (mock localStorage) ───────────────────────────────────────

function mockLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('saveLayout → loadLayout round-trips per scene', () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = mockLocalStorage();
  try {
    let s = splitPane(createState('top_down'), '', 'v');
    s = bindView(s, 'front', 'b');
    saveLayout('titanic', s);
    assert.ok(globalThis.localStorage._map.has(STORAGE_PREFIX + 'titanic'));
    const loaded = loadLayout('titanic', ['top_down', 'front']);
    assert.deepEqual(loaded, s);
    // A different scene has nothing saved → null (legitimate "no layout yet").
    assert.equal(loadLayout('test_bench', ['top_down', 'front']), null);
  } finally {
    globalThis.localStorage = prev;
  }
});

test('loadLayout throws on a corrupt entry (loud recovery, not silent fallback)', () => {
  const prev = globalThis.localStorage;
  const ls = mockLocalStorage();
  ls.setItem(STORAGE_PREFIX + 'titanic', '{ not json');
  globalThis.localStorage = ls;
  try {
    assert.throws(() => loadLayout('titanic', ['top_down']));
  } finally {
    globalThis.localStorage = prev;
  }
});

test('loadLayout throws on a stale viewId no longer in the scene', () => {
  const prev = globalThis.localStorage;
  const ls = mockLocalStorage();
  globalThis.localStorage = ls;
  try {
    saveLayout('titanic', bindView(splitPane(createState('old'), '', 'v'), 'gone', 'b'));
    assert.throws(() => loadLayout('titanic', ['top_down', 'front']), /unknown view/);
    clearLayout('titanic');
    assert.equal(ls.getItem(STORAGE_PREFIX + 'titanic'), null);
  } finally {
    globalThis.localStorage = prev;
  }
});

test('saveLayout throws loudly when localStorage is unavailable', () => {
  const prev = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.throws(() => saveLayout('titanic', createState('x')), /localStorage is unavailable/);
  } finally {
    if (prev !== undefined) globalThis.localStorage = prev;
  }
});
