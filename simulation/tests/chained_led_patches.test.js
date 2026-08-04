/**
 * chained_led_patches.test.js — CHAINING IS THE PATCH (operator ruling
 * 2026-08-03, report 20260725_123): *"unbound should not cause the lights to go
 * off or unpatched red."*
 *
 * Background. Report `_121` found five of the operator's LED cards chained,
 * saved, and dark: `computeLedStrandPatches` gated the whole patch chain on
 * `isBoundLedController`, so a card with no `device:` block projected nothing —
 * while the mapping pane read "✓ fully patched" over it. `_121` proposed making
 * the dark state louder. The operator ruled the opposite way: the dark state was
 * the bug. Typing an IP and chaining fixtures IS patching; the device binding is
 * a hardware CLAIM (first-contact reconcile, push receipts), never an address
 * gate. That also relaxes `_92` §4 — routing to an operator-typed but unverified
 * address is his accepted risk, and was the entire point of optional discovery.
 *
 * What is pinned here:
 *   R1 — every LED card that carries chains projects, at ANY binding grade, and
 *        byte-identically across grades.
 *   R2 — the ONE loud LED state left: chained with no usable destination IP.
 *        Patches/model/sim are unaffected; only the wire route is impossible.
 *   R3 — the pane counts LED violations (they used to be dropped wholesale), so
 *        an unroutable card can no longer leave the header green — while an
 *        unbound-but-routed card leaves it quiet, because nothing is wrong.
 *   R4 — the quiet per-card cues: a muted "board unverified" tag, a red banner
 *        ONLY for no-destination, and the "No Controller" placeholder card.
 *   R5 — the ⚑ affordance the operator actually used stays a working,
 *        address-neutral convenience.
 *
 * DOM/CSS contracts are pinned the way the pane's other stylesheet contracts are
 * (controller_pane_ergonomics.test.js): assert the rules exist and that the JS
 * emits the class names those rules key on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createControllerRegistry,
  markControllerProvisional,
  CONTROLLER_TYPE_LED,
  CONTROLLER_TYPE_DMX,
} from '../src/dmx/controller_registry.js';
import { computeLedStrandPatches } from '../src/dmx/led/led_patch_projection.js';

// controller_map_editor.js is a browser module (its siblings assign `window` at
// load) — same stub-then-dynamic-import recipe as controllers_pane_toggle.test.js.
globalThis.window = globalThis.window || {};
const {
  headerStatusModel,
  isChainedLedWithoutDestination,
  chainedNamesOn,
} = await import('../src/gui/controller_map_editor.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Line endings normalized: these are source/stylesheet contract assertions and
// must not depend on whether a file landed CRLF or LF on this machine.
const read = (...p) =>
  fs.readFileSync(path.join(HERE, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const CSS = read('style.css');
const EDITOR = read('src', 'gui', 'controller_map_editor.js');
const DISCOVERY = read('src', 'gui', 'led_discovery_panel.js');

/** The body of the first CSS rule whose selector matches exactly. */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(m, `no CSS rule for '${selector}'`);
  return m[2];
}

/** The operator's real shape: a TE-sign LED card, two halves on two outputs. */
function signCard({ device, ip = '10.9.9.23' } = {}) {
  return {
    id: 23,
    name: 'LeftTeSign',
    ip,
    type: CONTROLLER_TYPE_LED,
    protocol: 'sACN',
    led: { order: 'RGBW', startAddr: 1 },
    ports: [
      { port: 1, output: 1, universe: 38, chain: ['TE Sign V3 A'] },
      { port: 2, output: 2, universe: 39, chain: ['TE Sign V3 B'] },
    ],
    ...(device ? { device } : {}),
  };
}

const SIGN_COUNTS = new Map([['TE Sign V3 A', 40], ['TE Sign V3 B', 40]]);
const VERIFIED = {
  vendor: 'marsinled', controllerId: 'titanic_23', deviceName: 'Titanic-23', boardId: 'angio4',
};

// ── R1: chaining is the patch, at every grade ────────────────────────────

test('R1: unbound / provisional / verified project BYTE-IDENTICAL patches', () => {
  const grades = {
    unbound: createControllerRegistry({ controllers: [signCard()] }),
    provisional: createControllerRegistry({
      controllers: [signCard({ device: { vendor: 'marsinled', provisional: true } })] }),
    verified: createControllerRegistry({ controllers: [signCard({ device: VERIFIED })] }),
  };
  const results = Object.fromEntries(
    Object.entries(grades).map(([k, reg]) => [k, computeLedStrandPatches(reg, SIGN_COUNTS)]));

  for (const [grade, res] of Object.entries(results)) {
    assert.equal(res.fields.size, 2, `${grade}: both sign halves patch`);
    assert.deepEqual(res.violations, [], `${grade}: a chained card with an IP is not a defect`);
    assert.deepEqual(res.fields.get('TE Sign V3 A'), results.verified.fields.get('TE Sign V3 A'),
      `${grade} must be byte-identical to verified`);
  }
  // Per-output firmware: each output starts at ITS universe, channel 1.
  assert.equal(results.unbound.fields.get('TE Sign V3 A').dmxUniverse, 38);
  assert.equal(results.unbound.fields.get('TE Sign V3 B').dmxUniverse, 39);
  assert.equal(results.unbound.fields.get('TE Sign V3 A').controllerIp, '10.9.9.23',
    'the typed IP is the destination — this is what makes a relay route exist');
});

test('R1: a strand chained NOWHERE is still absent (the only unpatched state left)', () => {
  const reg = createControllerRegistry({ controllers: [signCard()] });
  const { fields } = computeLedStrandPatches(
    reg, new Map([...SIGN_COUNTS, ['Orphan Strand', 40]]));
  assert.equal(fields.has('Orphan Strand'), false);
});

// ── R2: the one loud LED state — no destination ──────────────────────────

test('R2: chained with NO IP patches everything and raises led_no_destination_ip', () => {
  const reg = createControllerRegistry({ controllers: [signCard({ ip: '' })] });
  const { fields, violations } = computeLedStrandPatches(reg, SIGN_COUNTS);
  assert.equal(fields.size, 2, 'patches, model lanes and the lit sim are unaffected');
  assert.equal(fields.get('TE Sign V3 A').controllerIp, '',
    'the empty destination is honest — the bridge refuses to invent one');
  assert.deepEqual(violations.map((v) => v.code), ['led_no_destination_ip']);
  assert.equal(violations[0].controllerId, 23, 'keyed by REGISTRY id, like every pane violation');
  assert.equal(violations[0].port, undefined, 'a CARD-level fact, not a port row');
});

test('R2: no IP + no chains is silent — nothing needs a destination yet', () => {
  const card = signCard({ ip: '' });
  for (const port of card.ports) port.chain = [];
  const reg = createControllerRegistry({ controllers: [card] });
  assert.deepEqual(computeLedStrandPatches(reg, SIGN_COUNTS).violations, []);
});

test('R2: a DMX controller is never asked for an LED destination', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'DmxBox', ip: '', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 1, universe: 4, chain: ['Par 1'] }],
    }],
  });
  assert.deepEqual(computeLedStrandPatches(reg, SIGN_COUNTS).violations, []);
});

// ── R3: the pane header tells the truth in BOTH directions ───────────────

test('R3: fully-patched needs an active registry, zero unmapped AND zero violations', () => {
  assert.equal(headerStatusModel(true, 0, 0).fullyPatched, true);
  assert.equal(headerStatusModel(true, 0, 0).text, '✓ fully patched');
  assert.equal(headerStatusModel(false, 0, 0).fullyPatched, false, 'no registry = no verdict');
  assert.equal(headerStatusModel(true, 2, 0).fullyPatched, false);
  assert.equal(headerStatusModel(true, 0, 1).fullyPatched, false);
  assert.equal(headerStatusModel(true, 0, 1).text, '1 violation(s) ⚠');
});

test('R3: an UNBOUND but routed card leaves the header GREEN (nothing is wrong)', () => {
  // Operator addendum 2026-08-03: keep the pane quiet for cards that do patch.
  const reg = createControllerRegistry({ controllers: [signCard()] });
  const led = computeLedStrandPatches(reg, SIGN_COUNTS).violations;
  assert.equal(headerStatusModel(true, 0, led.length).fullyPatched, true);
});

test('R3: an UNROUTABLE card turns the header — LED violations reach it now', () => {
  const reg = createControllerRegistry({ controllers: [signCard({ ip: '' })] });
  const led = computeLedStrandPatches(reg, SIGN_COUNTS).violations;
  const status = headerStatusModel(true, 0, led.length);
  assert.equal(status.fullyPatched, false);
  assert.match(status.cls, /cm-warn/);
});

test('R3: the pane threads LED violations into the header AND the banner', () => {
  // The MAJOR finding of `_121`: computeRenderProjection kept only `.fields`, so
  // EVERY LED violation was console-only. Pin the seam that carries them.
  assert.match(EDITOR, /lastLedViolations = ledPatches\.violations/);
  assert.match(
    EDITOR,
    /function allViolations\(proj\) \{\s*return \[\.\.\.proj\.violations, \.\.\.lastLedViolations\];/,
    'one combined list feeds the header and the banner');
  const start = EDITOR.indexOf('\nfunction render() {');
  assert.ok(start > 0, 'render() not found');
  const fn = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  assert.match(fn, /const violations = allViolations\(proj\);/);
  assert.match(fn, /headerStatusModel\(registryIsActive\(reg\), unmappedTotal, violations\.length\)/);
  assert.match(fn, /violations\.map\(v => `✋ \$\{v\.message\}`\)/);
  assert.doesNotMatch(fn, /proj\.violations\.length/,
    'no surviving DMX-only violation count in render()');
});

// ── R4: quiet cues, one loud banner, and the No-Controller card ──────────

test('R4: isChainedLedWithoutDestination is exactly "LED + chained + unusable IP"', () => {
  const routed = createControllerRegistry({ controllers: [signCard()] }).controllers[0];
  assert.equal(isChainedLedWithoutDestination(routed), false, 'unbound but routed is FINE');
  assert.deepEqual(chainedNamesOn(routed), ['TE Sign V3 A', 'TE Sign V3 B']);

  const noIp = createControllerRegistry({ controllers: [signCard({ ip: '' })] }).controllers[0];
  assert.equal(isChainedLedWithoutDestination(noIp), true);

  const emptyCard = signCard({ ip: '' });
  for (const p of emptyCard.ports) p.chain = [];
  const empty = createControllerRegistry({ controllers: [emptyCard] }).controllers[0];
  assert.equal(isChainedLedWithoutDestination(empty), false);

  const dmx = createControllerRegistry({
    controllers: [{
      id: 1, name: 'DmxBox', ip: '', type: CONTROLLER_TYPE_DMX,
      ports: [{ port: 1, universe: 4, chain: ['Par 1'] }],
    }],
  }).controllers[0];
  assert.equal(isChainedLedWithoutDestination(dmx), false);
});

test('R4: the card banner fires ONLY on no-destination, and survives collapsing', () => {
  const start = EDITOR.indexOf('function renderController(controller, proj) {');
  assert.ok(start > 0, 'renderController not found');
  const fn = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  assert.match(fn, /if \(isChainedLedWithoutDestination\(controller\)\) \{/);
  assert.match(fn, /card\.classList\.add\('cm-controller-nodest'\)/);
  assert.match(fn, /card\.appendChild\(renderNoDestinationBanner\(controller\)\)/);
  assert.ok(fn.indexOf('renderNoDestinationBanner') < fn.indexOf('if (isCollapsed) {'),
    'a collapsed card must still shout it');
});

test('R4: NOTHING in the LED port row styles a chip as unpatched or preview', () => {
  // The `_121` fix direction (amber/dashed "not patched" chips) was overruled —
  // these cards patch, so their chips must look like every other patched chip.
  const start = EDITOR.indexOf('function renderLedPort(controller, port, proj) {');
  assert.ok(start > 0, 'renderLedPort not found');
  const fn = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  assert.doesNotMatch(fn, /cm-chip-preview/);
  assert.doesNotMatch(fn, /not patched/);
  assert.doesNotMatch(fn, /isBoundLedController/,
    'the port row must not branch on binding grade at all any more');
  assert.match(fn, /lastLedBoundFields\.get\(name\)/,
    'ONE projection feeds the chips — what they show IS what patches.yaml carries');
});

test('R4: the unbound-but-chained cue is one muted tag, not a badge or a banner', () => {
  const start = DISCOVERY.indexOf('export function renderDeviceBindingSection(ctx, controller) {');
  assert.ok(start > 0, 'renderDeviceBindingSection not found');
  const fn = DISCOVERY.slice(start, DISCOVERY.indexOf('\nexport function ', start + 1));
  assert.match(fn, /'led-device-tag led-device-unverified', '⚑ board unverified'/);
  assert.match(fn, /if \(chainedCount > 0 && validIp\)/,
    'only for a card that is chained AND routed — the no-IP case has its own banner');
  // An unbound card still carries NO grade badge (report `_96` §6.2, pinned live
  // by agent_tools/provisional_status_verify.cjs). Comments stripped: the block
  // explains itself in prose that names the class it must not emit.
  const code = fn.slice(fn.indexOf('if (!verified && !provisional)'))
    .split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /led-binding-badge/);
  assert.equal(ruleBody(CSS, '.led-device-tag').includes('var(--secondary)'), true,
    'muted, not a warning colour');
});

test('R4: the "No Controller" card exists, is quiet, and offers the way out', () => {
  const start = EDITOR.indexOf('function renderNoControllerCard(unmapped, unmappedStrands) {');
  assert.ok(start > 0, 'renderNoControllerCard not found');
  const fn = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  assert.match(fn, /card\.className = 'cm-none-card'/);
  assert.doesNotMatch(fn, /className = '[^']*cm-controller[ ']/,
    'it must NOT join .cm-controller — four agent_tools enumerate that class as REAL cards');
  assert.match(fn, /🚫 No Controller/);
  assert.match(fn, /onclick = showAddControllerModal/, 'it is an entry point, not just a label');
  assert.match(EDITOR, /if \(unmappedTotal > 0\) main\.appendChild\(renderNoControllerCard\(/,
    'shown exactly when something is attached to nothing');
  assert.match(ruleBody(CSS, '.cm-none-card'), /border:\s*1px dashed/);
  assert.match(ruleBody(CSS, '.cm-none-head'), /var\(--secondary\)/, 'quiet, not an alarm');
});

test('R4: the loud banner is red and reserved for no-destination only', () => {
  for (const selector of ['.cm-nodest-banner', '.cm-nodest-banner-head', '.cm-nodest-banner-body']) {
    assert.match(ruleBody(CSS, selector), /var\(--error\)/, `${selector} must read as an error`);
  }
  assert.equal(/cm-unbound-banner|cm-chip-preview|cm-led-derived-preview/.test(CSS), false,
    'the overruled amber "not patched" styling must not survive anywhere');
});

// ── R5: the ⚑ path the operator actually used ────────────────────────────

test('R5: ⚑ stays a working, address-neutral convenience', () => {
  const reg = createControllerRegistry({ controllers: [signCard()] });
  const before = computeLedStrandPatches(reg, SIGN_COUNTS).fields;
  markControllerProvisional(reg.controllers[0]);
  const after = computeLedStrandPatches(reg, SIGN_COUNTS);
  assert.deepEqual(after.violations, []);
  for (const [name, rec] of after.fields) {
    assert.deepEqual(rec, before.get(name), `'${name}' must not move when the board is claimed`);
  }
});

test('R5: the button keeps the operator\'s own name and the class the probe clicks', () => {
  // He pressed "⚑ Patch without the board" and it worked — do not rename it out
  // from under him. agent_tools/provisional_status_verify.cjs drives the class.
  assert.match(DISCOVERY, /'cm-btn led-device-mark-provisional', '⚑ Patch without the board'/);
  assert.match(DISCOVERY, /markBtn\.title = `Optional — already patched\./,
    'the tooltip carries the meaning: convenience, not a prerequisite');
});

test('R5: no UI string this change touched runs long (operator: keep messages short)', () => {
  const strings = [
    /markBtn\.title = `([^`]*)`/,
    /tag\.title = `([^`]*)`/,
  ];
  for (const re of strings) {
    const m = re.exec(DISCOVERY.replace(/`\s*\+\s*\n\s*'/g, '').replace(/'\s*\+\s*\n\s*'/g, ''));
    assert.ok(m, `no match for ${re}`);
  }
  // The card banner is two short lines, not a paragraph.
  const start = EDITOR.indexOf('function renderNoDestinationBanner(controller) {');
  const fn = EDITOR.slice(start, EDITOR.indexOf('\nfunction ', start + 1));
  const body = /body\.textContent = ([^;]*);/.exec(fn);
  assert.ok(body, 'banner body not found');
  assert.ok(body[1].length < 140, `banner body copy is too long: ${body[1].length} chars`);
});
