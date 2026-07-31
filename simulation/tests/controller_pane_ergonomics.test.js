/**
 * controller_pane_ergonomics.test.js — the two live-mapping ergonomics fixes
 * on the Controller Mapping pane (operator, same session as the Controllers
 * hide/show toggle in controllers_pane_toggle.test.js):
 *
 *  G1 — the controller card header is TWO rows: identity (name + IP) on top,
 *       actions (type / transport / +port / delete) below. One row starved the
 *       name box, which truncated real controller names to a few characters.
 *  G2 — the name input can no longer collapse: it grows with the row AND has a
 *       readable minimum width, instead of inheriting `.cm-input`'s
 *       `min-width: 0` with a zero flex-basis.
 *  G3 — the `⚠ UNPATCHED — SIM-ONLY MODE` pill is moved OFF the docked mapping
 *       pane (it was landing on the unmapped-tray chip grid and covering
 *       fixture names mid-pick). It is relocated, never suppressed — the
 *       operator is mapping real hardware and must keep seeing that status.
 *
 * These are DOM/CSS-layout contracts, so they are pinned the way the sim's
 * other stylesheet-contract tests are: by asserting the rules exist and that
 * the JS emits the class names those rules key on. The live geometry (real
 * pixel widths, real overlap rectangles) is proven in the browser by
 * agent_tools/controllers_pane_toggle_verify.cjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Line endings normalized: these are source/stylesheet contract assertions and
// must not depend on whether a file landed CRLF or LF on this machine.
const read = (...p) =>
  fs.readFileSync(path.join(HERE, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const CSS = read('style.css');
const EDITOR = read('src', 'gui', 'controller_map_editor.js');
const SPLIT = read('src', 'gui', 'split_layout.js');

/** The body of the first CSS rule whose selector matches exactly. */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(m, `no CSS rule for '${selector}'`);
  return m[2];
}

// ── G1: two-row controller card header ───────────────────────────────────

test('the controller card header stacks its rows', () => {
  assert.match(ruleBody(CSS, '.cm-controller-head'), /flex-direction:\s*column/);
});

test('both header rows are laid out and styled', () => {
  assert.match(ruleBody(CSS, '.cm-controller-head-row'), /display:\s*flex/);
});

test('the editor emits an identity row and an action row', () => {
  assert.match(EDITOR, /cm-controller-head-row cm-controller-id-row/);
  assert.match(EDITOR, /cm-controller-head-row cm-controller-action-row/);
});

test('identity row carries the name + IP, action row carries the buttons', () => {
  const idRow = /idRow\.appendChild\((\w+)\);\s*idRow\.appendChild\((\w+)\);\s*idRow\.appendChild\((\w+)\);/
    .exec(EDITOR);
  assert.ok(idRow, 'identity row must append exactly three children');
  assert.deepEqual(idRow.slice(1), ['toggleBtn', 'nameInp', 'ipInp']);
  for (const btn of ['typeBtn', 'protoBtn', 'addPortBtn', 'delBtn']) {
    assert.match(EDITOR, new RegExp(`actionRow\\.appendChild\\(${btn}\\)`),
      `${btn} belongs on the action row`);
  }
});

test('the card header has exactly the two rows as children', () => {
  // A stray head.appendChild inside renderController would silently create a
  // third, unstyled row. (`head` is a local name reused by the group/port/tray
  // renderers, so scope the scan to this function.)
  const start = EDITOR.indexOf('function renderController(controller, proj) {');
  assert.ok(start > 0, 'renderController not found');
  const end = EDITOR.indexOf('\nfunction ', start + 1);
  const fn = EDITOR.slice(start, end);
  const appends = fn.match(/\bhead\.appendChild\((\w+)\)/g) || [];
  assert.deepEqual(appends, ['head.appendChild(idRow)', 'head.appendChild(actionRow)']);
});

// ── G2: the name box cannot collapse ─────────────────────────────────────

test('the controller name input grows and has a readable floor', () => {
  const body = ruleBody(CSS, '.cm-input.cm-name');
  const min = /min-width:\s*(\d+)px/.exec(body);
  assert.ok(min, '.cm-name must set an explicit min-width');
  assert.ok(Number(min[1]) >= 100, `min-width ${min[1]}px is too small to read a name`);
  // `flex: 1` is shorthand for `1 1 0%` — a zero basis is what let the fixed
  // IP box and the buttons take the row first.
  assert.match(body, /flex:\s*1\s+1\s+auto/);
});

test('the name box floor still fits beside the docked IP box', () => {
  const nameMin = Number(/min-width:\s*(\d+)px/.exec(ruleBody(CSS, '.cm-input.cm-name'))[1]);
  const ipDocked = Number(/width:\s*(\d+)px/
    .exec(ruleBody(CSS, '#controller-map-panel.cm-split-docked .cm-input.cm-ip'))[1]);
  // MIN_MAP in split_layout.js is the narrowest the map pane ever gets.
  const minPane = Number(/const MIN_MAP = (\d+);/.exec(SPLIT)[1]);
  assert.ok(nameMin + ipDocked + 60 < minPane,
    `name(${nameMin}) + ip(${ipDocked}) + chrome must fit the ${minPane}px pane`);
});

// ── G4: tray + picker are name-sorted, and the filter stays cheap ────────

test('both tray sources are sorted with the shared comparator', () => {
  for (const fn of ['unmappedNames', 'unmappedStrandNames']) {
    const start = EDITOR.indexOf(`function ${fn}() {`);
    assert.ok(start > 0, `${fn} not found`);
    const body = EDITOR.slice(start, EDITOR.indexOf('}', start));
    assert.match(body, /\.sort\(compareNatural\)/, `${fn} must sort by name`);
  }
});

test('the tray resolves its source lists ONCE per render, not per keystroke', () => {
  // renderChips() is the filter-box `oninput` handler. Calling
  // unmappedNames()/unmappedStrandNames() from inside it re-walks every scene
  // config and every chain entry — and would now re-sort — on every character
  // typed. The operator's constraint is that typing stays instant.
  const start = EDITOR.indexOf('function renderChips() {');
  assert.ok(start > 0, 'renderChips not found');
  const end = EDITOR.indexOf('\n  }\n  renderChips();', start);
  assert.ok(end > start, 'renderChips end not found');
  const body = EDITOR.slice(start, end);
  assert.doesNotMatch(body, /unmappedNames\(\)/);
  assert.doesNotMatch(body, /unmappedStrandNames\(\)/);
  assert.match(body, /trayFixtureNames|trayStrandNames/);
});

test('the chain chips inside a port are NOT name-sorted', () => {
  // A port's chain is the physical daisy-chain order (and the home of the
  // `at:` addresses). Sorting it by name would misreport the wiring.
  const start = EDITOR.indexOf('function renderChain(');
  if (start < 0) return; // renderer renamed — the tray tests still hold
  const body = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  assert.doesNotMatch(body, /compareNatural/);
});

// ── G3: UNPATCHED pill keep-out ──────────────────────────────────────────

test('split_layout publishes the sim pane edge and the keep-out classes', () => {
  assert.match(SPLIT, /--sim-pane-left/);
  assert.match(SPLIT, /classList\.toggle\('sim-map-docked'/);
  assert.match(SPLIT, /classList\.toggle\('sim-map-full'/);
});

test('the keep-out is applied on every layout branch', () => {
  for (const mode of ['none', 'split', 'simMax', 'mapMax']) {
    assert.match(SPLIT, new RegExp(`setHudKeepOut\\('${mode}'`),
      `applyLayout must set the keep-out for '${mode}'`);
  }
});

test('the docked pill is pushed past the map pane, not hidden', () => {
  const body = ruleBody(CSS, 'body.sim-map-docked #unpatched-warning');
  assert.match(body, /left:\s*calc\(var\(--sim-pane-left/);
  assert.doesNotMatch(body, /display:\s*none/);
  assert.doesNotMatch(body, /visibility:\s*hidden/);
  assert.doesNotMatch(body, /opacity:\s*0/);
});

test('the maximized-pane pill moves to the corner, still visible', () => {
  const body = ruleBody(CSS, 'body.sim-map-full #unpatched-warning');
  assert.match(body, /right:\s*\d+px/);
  assert.doesNotMatch(body, /display:\s*none/);
});

test('the pill keeps its own home rule for the undocked full-window view', () => {
  const home = ruleBody(CSS, '#unpatched-warning');
  assert.match(home, /position:\s*fixed/);
  assert.match(home, /left:\s*\d+px/);
});

// ── G5: unmapped tray + anchored Save row ────────────────────────────────
// Operator screenshot 2026-07-30: the "💾 Save Configuration" button painted
// ON TOP of the tray chips. Root cause: .cm-tray could be flex-shrunk below
// its own content (min-height:0) while its `overflow` stayed VISIBLE and the
// chip grid carried a hard 40px floor — so the chips spilled out of the tray
// box onto the Save row that follows them in .cm-body. The taller MarsinLED
// gamma cards are what pushed the column into negative free space and made a
// latent bug visible. The fix is structural, so it is pinned structurally.

test('the Save button has its own footer row, not a bare slot in the column', () => {
  assert.match(EDITOR, /footer\.className = 'cm-footer'/);
  assert.match(EDITOR, /footer\.appendChild\(saveBtn\)/);
  assert.match(EDITOR, /bodyEl\.appendChild\(footer\)/);
  // The old shape — the button dropped straight into the flex column with
  // nothing reserving its space — must not come back.
  assert.doesNotMatch(EDITOR, /bodyEl\.appendChild\(saveBtn\)/);
});

test('the save row never shrinks, so it can never be pushed under the tray', () => {
  assert.match(ruleBody(CSS, '.cm-footer'), /flex:\s*0\s+0\s+auto/);
});

test('nothing in the tray/save region is positioned out of flow', () => {
  // An absolutely-positioned Save button is the other way this overlap comes
  // back, and it would be invisible to every flex rule above.
  for (const sel of ['.cm-footer', '.cm-tray', '.cm-tray-chips', '.cm-hint',
    '.vm-btn.vm-save']) {
    assert.doesNotMatch(ruleBody(CSS, sel), /position:\s*(absolute|fixed|sticky)/,
      `${sel} must stay in normal flow`);
  }
});

test('the tray clips its own content instead of painting over its neighbours', () => {
  const body = ruleBody(CSS, '.cm-tray');
  assert.match(body, /overflow:\s*hidden/);
  assert.match(body, /min-height:\s*0/);
  // Shrinkable: a tray that cannot shrink pushes the Save row off the pane
  // instead, which is the same bug wearing a different hat.
  assert.match(body, /flex:\s*0\s+1\s+auto/);
});

test('the chip grid scrolls and carries no min-height floor in any state', () => {
  const base = ruleBody(CSS, '.cm-tray-chips');
  assert.match(base, /overflow-y:\s*auto/);
  assert.match(base, /flex:\s*1\s+1\s+auto/);
  // A floor on the chip grid inside a shrinkable tray is exactly what spilled
  // the chips out of the tray box — in every one of the three states.
  for (const sel of ['.cm-tray-chips',
    '#controller-map-panel.cm-user-sized .cm-tray-chips',
    '.cm-body.cm-controllers-collapsed .cm-tray-chips']) {
    const min = /min-height:\s*([\d.]+)(px|em|rem|%)?/.exec(ruleBody(CSS, sel));
    assert.ok(min, `${sel} must state its min-height explicitly`);
    assert.equal(Number(min[1]), 0, `${sel} min-height must be 0, got ${min[0]}`);
  }
});

test('the docked pane guarantees the tray a floor the cards cannot eat', () => {
  // Tall MarsinLED cards used to squeeze the tray toward nothing. The docked
  // pane is always full screen height, so the tray gets a hard floor and
  // .cm-main — which scrolls — gives the space up instead.
  const trayFloor = Number(/min-height:\s*(\d+)px/
    .exec(ruleBody(CSS, '#controller-map-panel.cm-split-docked .cm-tray'))[1]);
  assert.ok(trayFloor >= 80, `${trayFloor}px is not enough for the head + a chip row`);
  assert.match(ruleBody(CSS, '.cm-main'), /overflow-y:\s*auto/);
});

test('chips wrap into readable rows, not a single blob', () => {
  const body = ruleBody(CSS, '.cm-tray-chips');
  assert.match(body, /flex-wrap:\s*wrap/);
  assert.match(body, /align-content:\s*flex-start/);
  const row = Number(/row-gap:\s*([\d.]+)px/.exec(body)[1]);
  const col = Number(/column-gap:\s*([\d.]+)px/.exec(body)[1]);
  assert.ok(row >= col, `row-gap (${row}px) must be at least the column-gap (${col}px)`);
});

test('the tray head wraps rather than squeezing the title or the filter box', () => {
  const head = ruleBody(CSS, '.cm-tray-head');
  assert.match(head, /flex-wrap:\s*wrap/);
  const title = ruleBody(CSS, '.cm-tray-title');
  assert.match(title, /min-width:\s*\d+px/);
});

test('the filter box width is a stylesheet rule, not an inline style', () => {
  // An inline width cannot be overridden for the docked pane, and it made the
  // box the one item that never adapted to the pane.
  assert.match(EDITOR, /filter\.className = 'cm-input cm-tray-filter'/);
  assert.doesNotMatch(EDITOR, /filter\.style\.width/);
  assert.match(ruleBody(CSS, '.cm-input.cm-tray-filter'), /width:\s*\d+px/);
});

test('the help text yields space before the Save row does', () => {
  const hint = ruleBody(CSS, '.cm-hint');
  assert.match(hint, /flex:\s*0\s+1\s+auto/);   // shrinkable…
  assert.match(hint, /min-height:\s*0/);
  assert.match(hint, /overflow:\s*hidden/);     // …and clipped, never overlapping
  assert.match(hint, /margin-top:\s*\d+px/);    // its own spacing under the row
});

test('the docked pane keeps the hint whole, so the Save row never hops', () => {
  // Measured on the real pane: with a shrinkable hint the Save row moved 34px
  // between the expanded and collapsed states and the help text was truncated
  // mid-sentence. The docked pane is always full height, so only .cm-main and
  // .cm-tray give — which pins the Save row to one constant y.
  assert.match(ruleBody(CSS, '#controller-map-panel.cm-split-docked .cm-hint'),
    /flex:\s*0\s+0\s+auto/);
});

test('#cm-body is built in the order the layout rules assume', () => {
  // main (scrolls) → tray (clips) → footer (fixed) → hint (yields). Any other
  // order breaks the "Save is always the last thing standing" contract.
  const order = ['bodyEl.appendChild(main)', 'bodyEl.appendChild(renderTray(',
    'bodyEl.appendChild(footer)', 'bodyEl.appendChild(hint)'];
  let at = -1;
  for (const step of order) {
    const next = EDITOR.indexOf(step, at + 1);
    assert.ok(next > at, `${step} must come after the previous region`);
    at = next;
  }
});
