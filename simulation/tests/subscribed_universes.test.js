/**
 * subscribed_universes.test.js — the 📡 Subscribed Universes auto-sync
 * (report 20260725_86).
 *
 * The field (`colorWave.sacn_universes` in scenes/common.yaml) is the sACN-IN
 * bridge's BOOT accept-list, and the `sacn` package drops packets on
 * unsubscribed universes with no event at all — a stale field is dark fixtures
 * and a clean bill of health everywhere else (reports _58 §7.1 layer 6, _60).
 * These tests pin the four things that make the save-time gate trustworthy:
 *
 *   1. the required set is the UNION of every universe the configuration uses
 *      (DMX ports, LED per-output, stored patches, spill);
 *   2. required ⊆ subscribed never interrupts a save;
 *   3. a short field prompts, and the diff text names the controller behind
 *      every addition;
 *   4. yes / no / cancel do exactly what they say — and NOTHING is ever removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUBSCRIBED_UNIVERSES_LABEL,
  parseSubscribedUniverses,
  formatSubscribedUniverses,
  computeRequiredUniverses,
  computeSubscriptionUpdate,
  describeSubscriptionUpdate,
  syncSubscribedUniverses,
} from '../src/dmx/subscribed_universes.js';

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Synthetic registry ─────────────────────────────────────────────────────
// Two DMX controllers and two MarsinLED controllers, shaped like the real rig:
// a DMX port carrying fixtures, a DMX port with an EMPTY chain (declares a
// universe, projects no claim), an LED card whose ports drive outputs 1/2, and
// an LED card with a PARKED output.

function syntheticRegistry() {
  return {
    controllers: [
      {
        id: 1, name: 'LeftFrontDeck', ip: '192.168.1.60', type: 'DMX',
        ports: [
          { port: 1, universe: 2, chain: [] },
          { port: 2, universe: 23, chain: [] },
        ],
      },
      {
        id: 2, name: 'RightFrontDeck', ip: '192.168.1.61', type: 'DMX',
        ports: [{ port: 1, universe: 3, chain: [] }],
      },
      {
        id: 3, name: 'LeftLeftRopes', ip: '192.168.1.70', type: 'LED',
        ports: [
          { port: 1, universe: 26, output: 1, chain: [] },
          { port: 2, universe: 27, output: 2, chain: [] },
        ],
      },
      {
        id: 4, name: 'RightLeftRopes', ip: '192.168.1.71', type: 'LED',
        ports: [{ port: 1, universe: 30, output: 1, chain: [] }],
      },
    ],
  };
}

/** A `computeProjection().universeMaps`-shaped map. */
function dmxMaps(entries) {
  return new Map(entries);
}

/** A `computeLedUniverseClaims()`-shaped map (controllerId = PANEL ORDINAL). */
function ledMaps(entries) {
  return new Map(entries);
}

function fullSources() {
  const registry = syntheticRegistry();
  return {
    controllers: registry.controllers,
    dmxUniverseMaps: dmxMaps([
      [2, [{ start: 1, end: 10, name: 'Par 1', controllerId: 1, controllerName: 'LeftFrontDeck', portNum: 1 }]],
      [3, [{ start: 1, end: 10, name: 'Par 9', controllerId: 2, controllerName: 'RightFrontDeck', portNum: 1 }]],
      [1, [{ start: 5, end: 6, name: 'Fog TE', controllerId: 1, controllerName: 'LeftFrontDeck', portNum: 1, effect: true }]],
    ]),
    // Left_Left_Ropes spills off U26 into U28 (a 200 px RGBW run).
    ledClaims: ledMaps([
      [26, [{ start: 1, end: 512, name: 'Left_Left_Ropes', controllerId: 3, portNum: 1, led: true }]],
      [28, [{ start: 1, end: 288, name: 'Left_Left_Ropes', controllerId: 3, portNum: 1, led: true }]],
    ]),
    fixtures: [
      { name: 'Par 1', dmxUniverse: 2, dmxAddress: 1 },
      { name: 'Legacy Bar', dmxUniverse: 9, dmxAddress: 1 },   // patches.yaml only
      { name: 'Unpatched', dmxUniverse: 0, dmxAddress: 0 },
    ],
    ledStrands: [
      { name: 'Left_Left_Ropes', segments: [{ universe: 26 }, { universe: 28 }] },
      { name: 'Right_Left_Ropes', dmxUniverse: 30 },
    ],
  };
}

// ── 1. The required set ────────────────────────────────────────────────────

test('computeRequiredUniverses unions DMX ports, LED per-output, spill and patches', () => {
  const required = computeRequiredUniverses(fullSources());
  assert.deepEqual([...required.keys()], [1, 2, 3, 9, 23, 26, 27, 28, 30],
    'U1 pin, U2/U3 DMX claims, U9 patches-only fixture, U23 empty DMX port, U26/U28 LED start + ' +
    'spill, U27 second LED output, U30 second card — every one of them must be in the set');
});

test('an EMPTY declared port is required even though nothing projects a claim', () => {
  const required = computeRequiredUniverses(fullSources());
  assert.deepEqual(required.get(23), ['LeftFrontDeck port 2'],
    'a port with no fixtures still declares a universe the hardware listens on');
});

test('an LED port reason names the controller, the port row and the physical output', () => {
  const required = computeRequiredUniverses(fullSources());
  assert.deepEqual(required.get(27), ['LeftLeftRopes port 2 → output 2']);
  assert.ok(required.get(26).includes('LeftLeftRopes port 1 → output 1'));
  assert.ok(required.get(26).includes("LeftLeftRopes port 1 (LED strand 'Left_Left_Ropes')"),
    'the strand claim resolves the panel ordinal back to the controller name');
});

test('a strand SPILL universe is required (the classic silent-dark case)', () => {
  const required = computeRequiredUniverses(fullSources());
  assert.ok(required.has(28), 'U28 carries the tail of Left_Left_Ropes and nothing else declares it');
});

test('universes are reported ascending and reasons are deduped', () => {
  const required = computeRequiredUniverses(fullSources());
  const keys = [...required.keys()];
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  for (const reasons of required.values()) {
    assert.equal(reasons.length, new Set(reasons).size, 'no reason may be listed twice');
  }
});

test('unpatched and out-of-range universes are never claims', () => {
  const required = computeRequiredUniverses({
    controllers: [],
    dmxUniverseMaps: new Map(),
    ledClaims: new Map(),
    fixtures: [
      { name: 'Unpatched', dmxUniverse: 0 },
      { name: 'Absurd', dmxUniverse: 70000 },
      { name: 'Junk', dmxUniverse: 'nope' },
      { name: 'Real', dmxUniverse: 5 },
    ],
    ledStrands: [],
  });
  assert.deepEqual([...required.keys()], [5]);
});

test('computeRequiredUniverses refuses inputs of the wrong shape (no silent empty set)', () => {
  assert.throws(() => computeRequiredUniverses(), /sources object is required/);
  assert.throws(() => computeRequiredUniverses({ dmxUniverseMaps: {} }), /must be a Map/);
  assert.throws(() => computeRequiredUniverses({ ledClaims: {} }), /must be a Map/);
  assert.throws(() => computeRequiredUniverses({ controllers: 'nope' }),
    /controllers must be the registry/);
});

// ── 2. Parsing — bridge parity ─────────────────────────────────────────────

test('parseSubscribedUniverses matches the bridge arithmetic exactly', () => {
  // sacn_bridge.js: split(',') → parseInt → drop NaN. Deduped + sorted here.
  const { universes } = parseSubscribedUniverses(' 3, 1 ,2, 2, , 0, -4 ');
  assert.deepEqual(universes, [1, 2, 3], 'zero and negatives are not universes; dupes collapse');
});

test('a hand-typed RANGE is reported, not silently read as one universe', () => {
  const { universes, malformed } = parseSubscribedUniverses('1-24, 27');
  assert.deepEqual(universes, [1, 27], 'the bridge reads `1-24` as U1 — this must not be hidden');
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].token, '1-24');
  assert.match(malformed[0].reason, /U1 only/);
});

test('an empty field parses to nothing without throwing', () => {
  assert.deepEqual(parseSubscribedUniverses('').universes, []);
  assert.deepEqual(parseSubscribedUniverses(undefined).universes, []);
});

test('formatSubscribedUniverses round-trips the field form', () => {
  assert.equal(formatSubscribedUniverses([3, 1, 2, 1]), '1, 2, 3');
});

// ── 3. The diff ────────────────────────────────────────────────────────────

test('required ⊆ subscribed reports no change', () => {
  const required = new Map([[2, ['LeftFrontDeck port 1']], [3, ['RightFrontDeck port 1']]]);
  const update = computeSubscriptionUpdate({ currentValue: '1, 2, 3, 4', required });
  assert.equal(update.changed, false);
  assert.deepEqual(update.missing, []);
  assert.equal(update.nextValue, '1, 2, 3, 4');
});

test('missing universes are listed ascending with their reasons', () => {
  const update = computeSubscriptionUpdate({
    currentValue: '1, 2, 3',
    required: computeRequiredUniverses(fullSources()),
  });
  assert.equal(update.changed, true);
  assert.deepEqual(update.missing.map((m) => m.universe), [9, 23, 26, 27, 28, 30]);
  assert.equal(update.nextValue, '1, 2, 3, 9, 23, 26, 27, 28, 30');
});

test('the diff NEVER removes: extras survive into nextValue and are FYI only', () => {
  const required = new Map([[27, ['LeftLeftRopes port 2 → output 2']]]);
  const update = computeSubscriptionUpdate({ currentValue: '1, 2, 3, 99', required });
  assert.deepEqual(update.extras, [1, 2, 3, 99]);
  assert.equal(update.nextValue, '1, 2, 3, 27, 99', 'every currently-subscribed universe is kept');
  const described = describeSubscriptionUpdate(update);
  assert.match(described.extrasLine, /left in place/);
  assert.match(described.extrasLine, /never removes/);
});

test('computeSubscriptionUpdate refuses a non-Map required set', () => {
  assert.throws(() => computeSubscriptionUpdate({ currentValue: '1', required: {} }),
    /must be the Map returned by computeRequiredUniverses/);
});

// ── 4. The dialog text ─────────────────────────────────────────────────────

test('the description shows the change explicitly and names the controller per universe', () => {
  const update = computeSubscriptionUpdate({
    currentValue: '1, 2, 3, 9, 23, 26, 28',
    required: computeRequiredUniverses(fullSources()),
  });
  const described = describeSubscriptionUpdate(update);
  assert.equal(described.headline,
    `${SUBSCRIBED_UNIVERSES_LABEL}: 1, 2, 3, 9, 23, 26, 28 → 1, 2, 3, 9, 23, 26, 27, 28, 30`);
  assert.deepEqual(described.additionLines, [
    'U27 — LeftLeftRopes port 2 → output 2',
    "U30 — RightLeftRopes port 1 → output 1; patched strand 'Right_Left_Ropes'",
  ]);
  assert.equal(described.summary, 'adding U27, U30');
});

test('a clean field describes itself as no-change', () => {
  const update = computeSubscriptionUpdate({ currentValue: '1, 2', required: new Map([[1, ['x']]]) });
  assert.match(describeSubscriptionUpdate(update).summary, /no change/);
});

// ── 5. yes / no / cancel semantics ─────────────────────────────────────────

function gateHarness({ currentValue, required, answer, interactive = true }) {
  const state = { value: currentValue, prompts: 0, logs: [], warns: [] };
  const deps = {
    requiredUniverses: () => required,
    currentValue: () => state.value,
    applyValue: (v) => { state.value = v; },
    confirm: async (arg) => { state.prompts++; state.lastPrompt = arg; return answer; },
    log: (m) => state.logs.push(m),
    warn: (m) => state.warns.push(m),
    interactive,
  };
  return { state, deps };
}

test('a covering field saves silently — the dialog is never shown', async () => {
  const { state, deps } = gateHarness({
    currentValue: '1, 2, 3, 9, 23, 26, 27, 28, 30',
    required: computeRequiredUniverses(fullSources()),
    answer: 'cancel',   // would abort if it were ever consulted
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.proceed, true);
  assert.equal(result.choice, 'clean');
  assert.equal(state.prompts, 0, 'no popup spam when there is nothing to add');
  assert.equal(state.value, '1, 2, 3, 9, 23, 26, 27, 28, 30');
});

test("'yes' updates the field and lets the save proceed", async () => {
  const { state, deps } = gateHarness({
    currentValue: '1, 2, 3',
    required: computeRequiredUniverses(fullSources()),
    answer: 'yes',
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.proceed, true);
  assert.equal(result.choice, 'yes');
  assert.equal(state.prompts, 1);
  assert.equal(state.value, '1, 2, 3, 9, 23, 26, 27, 28, 30');
  // Report 20260725_87: the bridge re-reads this field on every route recompute
  // and the save notifies it, so the update lands on the RUNNING receiver. The
  // log line must say that — a stale "restart required" caveat is what sent the
  // operator to the launcher after a save that had already worked.
  assert.match(state.logs.join('\n'), /Takes effect IMMEDIATELY/,
    'the no-restart truth is stated on the record, not only in the dialog');
  assert.doesNotMatch(state.logs.join('\n'), /NEXT\s+sACN bridge start/,
    'the retired restart caveat must not survive anywhere in the log line');
});

test("'no' saves WITHOUT touching the field, and logs one line", async () => {
  const { state, deps } = gateHarness({
    currentValue: '1, 2, 3',
    required: computeRequiredUniverses(fullSources()),
    answer: 'no',
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.proceed, true);
  assert.equal(result.choice, 'no');
  assert.equal(state.value, '1, 2, 3', 'the operator knows better — nothing is rewritten');
  assert.equal(state.logs.length, 1);
  assert.match(state.logs[0], /declined/);
  assert.match(state.logs[0], /U9, U23, U26, U27, U28, U30/);
});

test("'cancel' aborts the save and changes nothing", async () => {
  const { state, deps } = gateHarness({
    currentValue: '1, 2, 3',
    required: computeRequiredUniverses(fullSources()),
    answer: 'cancel',
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.proceed, false, 'proceed:false is what makes exportConfig write nothing');
  assert.equal(result.choice, 'cancel');
  assert.equal(state.value, '1, 2, 3');
});

test('a non-interactive save never prompts, never writes, and warns once', async () => {
  const { state, deps } = gateHarness({
    currentValue: '1, 2, 3',
    required: computeRequiredUniverses(fullSources()),
    answer: 'yes',
    interactive: false,
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.proceed, true);
  assert.equal(result.choice, 'deferred');
  assert.equal(state.prompts, 0);
  assert.equal(state.value, '1, 2, 3');
  assert.equal(state.warns.length, 1);
  assert.match(state.warns[0], /next explicit 💾 save will ask/);
});

test('the prompt receives both the update and the rendered description', async () => {
  const { state, deps } = gateHarness({
    currentValue: '1',
    required: new Map([[27, ['LeftLeftRopes port 2 → output 2']]]),
    answer: 'yes',
  });
  await syncSubscribedUniverses(deps);
  assert.deepEqual(state.lastPrompt.described.additionLines,
    ['U27 — LeftLeftRopes port 2 → output 2']);
  assert.equal(state.lastPrompt.update.nextValue, '1, 27');
});

test('a malformed token warns even when nothing needs adding', async () => {
  const { state, deps } = gateHarness({
    currentValue: '1-24',
    required: new Map([[1, ['LeftFrontDeck port 1']]]),
    answer: 'yes',
  });
  const result = await syncSubscribedUniverses(deps);
  assert.equal(result.choice, 'clean');
  assert.equal(state.warns.length, 1);
  assert.match(state.warns[0], /1-24/);
});

test('an unexpected dialog answer throws instead of guessing', async () => {
  const { deps } = gateHarness({
    currentValue: '1',
    required: new Map([[27, ['x']]]),
    answer: 'maybe',
  });
  await assert.rejects(() => syncSubscribedUniverses(deps), /expected 'yes', 'no' or 'cancel'/);
});

test('syncSubscribedUniverses refuses a deps object missing an effect', async () => {
  await assert.rejects(() => syncSubscribedUniverses({ requiredUniverses: () => new Map() }),
    /deps\.currentValue must be a function/);
});

// ── 6. Wiring — the gate really guards the save path ───────────────────────

test('exportConfig runs the universe gate BEFORE the first write and honors cancel', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'src/gui/gui_builder.js'), 'utf8');
  const gateAt = src.indexOf('checkSubscribedUniversesBeforeSave({ interactive })');
  const modelAt = src.indexOf('saveModelJS();');
  assert.ok(gateAt > 0, 'exportConfig must call the gate');
  assert.ok(modelAt > gateAt,
    'the gate must run ahead of saveModelJS() — otherwise Cancel cannot mean "nothing written"');
  assert.match(src, /if \(!universeGate\.proceed\)[\s\S]{0,300}return \{ ok: false/,
    'a cancelled gate must abort the save with ok:false');
  assert.match(src, /exportConfig\(\{ interactive: false \}\)/,
    'the auto-save timer must opt out of the modal');
});

test('the controller pane Save button awaits the save (the dialog is in its path)', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'src/gui/controller_map_editor.js'), 'utf8');
  assert.match(src, /saveBtn\.onclick = async \(\) => \{[\s\S]{0,220}await window\.exportConfig\(\)/,
    'a fire-and-forget save would repaint the pane before the operator answered');
});

test('the prompt module reuses the push flow modal classes — no new framework', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'src/gui/subscribed_universes_prompt.js'), 'utf8');
  for (const cls of ['vm-modal-overlay', 'vm-modal-card led-push-card', 'vm-modal-title',
    'led-push-warn', 'led-push-subhead', 'led-push-diff', 'vm-modal-actions', 'vm-modal-btn']) {
    assert.ok(src.includes(cls), `dialog must reuse the existing class '${cls}'`);
  }
  assert.match(src, /Takes effect IMMEDIATELY on save — no bridge restart/,
    'the dialog must state the no-restart truth (report 20260725_87)');
  assert.match(src, /runtime-subscribed U/,
    'the dialog must name the bridge log line that proves the subscription landed');
  assert.doesNotMatch(src, /Takes effect at the NEXT sACN bridge start/,
    'the retired restart caveat must not survive in the dialog');
});
