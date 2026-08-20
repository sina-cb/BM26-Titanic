/* Live Touch operator-passcode gate.
 *
 * Operator ruling 2026-08-14: taking the rig FROM a running plan while
 * performance mode is live costs one of the three named operator passcodes,
 * EVERY TIME. The engine gate landed with _200; CaptainPad's prompt with _201.
 * This covers the third surface — the sim-served Live Touch panel, whose ARM
 * button is the remaining way to seize a running plan.
 *
 * P0: NO CREDENTIAL MATERIAL. Every passcode below is an obvious placeholder
 * injected through a test seam; nothing here resembles a real one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const MODULE_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_passcode.js');
const WIRE_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_wire.js');
const PANEL_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html');

const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
const wireSource = fs.readFileSync(WIRE_PATH, 'utf8');
const panelSource = fs.readFileSync(PANEL_PATH, 'utf8');

/* Obvious placeholders. The engine's real principals live only in the external
   $BM26_SECRETS file and are never needed here — the transport is faked. */
const RIGHT_CODE = 'placeholder-accepted-code';
const WRONG_CODE = 'placeholder-rejected-code';

// ── the smallest DOM that can host the prompt ──────────────────────────────
// No jsdom in this repo (offline readiness: nothing new is vendored for a
// test). This stub implements exactly the surface the prompt touches, which
// also documents that surface.
function makeElement(doc, tagName) {
  const listeners = new Map();
  return {
    tagName,
    style: {},
    children: [],
    parentNode: null,
    attributes: {},
    textContent: '',
    value: '',
    hidden: false,
    focusCount: 0,
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at < 0) throw new Error('removeChild: not a child');
      this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name] : null;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    focus() { this.focusCount += 1; },
    fire(type, event = {}) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler({ preventDefault() {}, ...event }));
    },
    ownerDocument: doc,
  };
}

function makeDocument() {
  const doc = { created: [] };
  doc.createElement = (tagName) => {
    const element = makeElement(doc, tagName);
    doc.created.push(element);
    return element;
  };
  doc.body = makeElement(doc, 'body');
  return doc;
}

function loadModule() {
  const storageCalls = [];
  const consoleCalls = [];
  const stubStorage = (name) => new Proxy({}, {
    get(_target, key) {
      storageCalls.push(`${name}.${String(key)}`);
      return () => { storageCalls.push(`${name}.${String(key)}()`); };
    },
    set(_target, key) {
      storageCalls.push(`${name}.${String(key)}=`);
      return true;
    },
  });
  const context = {
    window: {},
    Promise,
    Object,
    Error,
    Math,
    JSON,
    Array,
    String,
    Number,
    Boolean,
    localStorage: stubStorage('localStorage'),
    sessionStorage: stubStorage('sessionStorage'),
    console: {
      log: (...args) => consoleCalls.push(args),
      warn: (...args) => consoleCalls.push(args),
      error: (...args) => consoleCalls.push(args),
    },
  };
  vm.runInNewContext(moduleSource, context, { filename: MODULE_PATH });
  return { gate: context.window.TouchControlPasscode, storageCalls, consoleCalls };
}

function refusal(code, extra = {}) {
  const bodies = {
    TAKEOVER_AUTH_REQUIRED: {
      status: 401,
      error: 'performance mode is live — an operator passcode is required to take over '
        + 'from the timeline',
    },
    TAKEOVER_AUTH_INVALID: { status: 401, error: 'Operator passcode rejected.' },
    TAKEOVER_AUTH_RATE_LIMITED: {
      status: 429,
      error: 'Too many attempts. Wait before trying again.',
    },
  };
  const template = bodies[code];
  const error = new Error(`POST /layers/activate → ${template.status} refused`);
  error.takeoverRefusal = {
    status: template.status,
    code,
    reason: template.error,
    retryAfterMs: null,
    ...extra,
  };
  return error;
}

/* A prompt driven by a script of answers instead of an operator. Records one
   entry per ask() so "two ARMs → two prompts" is a countable fact. */
function scriptedPrompt(answers) {
  const asked = [];
  let closes = 0;
  return {
    asked,
    closeCount: () => closes,
    ask(detail) {
      asked.push(detail);
      if (!answers.length) throw new Error('the test ran out of scripted answers');
      return Promise.resolve(answers.shift());
    },
    close() { closes += 1; },
  };
}

/* One call per attempt — that shape is what makes "exactly one retry" provable. */
function recordingSend(outcomes) {
  const calls = [];
  const send = (passcode) => {
    calls.push(passcode);
    if (!outcomes.length) throw new Error('the test ran out of scripted outcomes');
    const next = outcomes.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { send, calls };
}

// ── refusal classification ─────────────────────────────────────────────────
test('only the engine\'s three takeover codes are treated as passcode refusals', () => {
  const { gate } = loadModule();
  ['TAKEOVER_AUTH_REQUIRED', 'TAKEOVER_AUTH_INVALID'].forEach((code) => {
    const parsed = gate.refusalFromResponse(401, JSON.stringify({ error: 'nope', code }));
    assert.equal(parsed.code, code);
    assert.equal(parsed.status, 401);
  });
  const limited = gate.refusalFromResponse(429, JSON.stringify({
    error: 'Too many attempts. Wait before trying again.',
    code: 'TAKEOVER_AUTH_RATE_LIMITED',
    retryAfterMs: 30000,
  }));
  assert.equal(limited.retryAfterMs, 30000);

  // A plain engine error is NOT a passcode problem: the operator must never be
  // asked to retype a passcode against "portwatch owns the rig".
  assert.equal(gate.refusalFromResponse(423, JSON.stringify({
    error: 'PortWatch owns the rig', code: 'LAYER_SETTING_LOCKED',
  })), null);
  assert.equal(gate.refusalFromResponse(401, JSON.stringify({ error: 'no session' })), null);
  assert.equal(gate.refusalFromResponse(409, JSON.stringify({
    code: 'TAKEOVER_AUTH_INVALID',
  })), null);
  assert.equal(gate.refusalFromResponse(401, 'not json at all'), null);
});

test('refusal messages carry the engine\'s reason and never the attempt', () => {
  const { gate } = loadModule();
  const required = gate.messageForRefusal(refusal('TAKEOVER_AUTH_REQUIRED').takeoverRefusal);
  assert.match(required, /performance mode is live/);
  assert.match(
    gate.messageForRefusal(refusal('TAKEOVER_AUTH_INVALID').takeoverRefusal),
    /Passcode rejected/,
  );
  assert.match(
    gate.messageForRefusal(refusal('TAKEOVER_AUTH_RATE_LIMITED', {
      retryAfterMs: 30000,
    }).takeoverRefusal),
    /locked out for 30 s/,
  );
  [required].forEach((message) => {
    assert.doesNotMatch(message, new RegExp(RIGHT_CODE));
    assert.doesNotMatch(message, new RegExp(WRONG_CODE));
  });
});

// ── the gate ───────────────────────────────────────────────────────────────
test('performance mode off sends exactly one request and never prompts', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([{ ok: true }]);
  const prompt = scriptedPrompt([]);
  const value = await gate.runGatedRequest(send, prompt, 'ARM');
  assert.deepEqual(value, { ok: true });
  assert.deepEqual(calls, [null]);
  assert.equal(prompt.asked.length, 0);
  assert.equal(prompt.closeCount(), 0);
});

test('a mid-flight mode flip prompts instead of failing silently', async () => {
  // Nothing tells this surface performance mode turned on; the ONLY signal is
  // the refusal on a request that was expected to sail through.
  const { gate } = loadModule();
  const { send, calls } = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED'), { ok: true }]);
  const prompt = scriptedPrompt([RIGHT_CODE]);
  await gate.runGatedRequest(send, prompt, 'ARM');
  assert.deepEqual(calls, [null, RIGHT_CODE]);
  assert.equal(prompt.asked.length, 1);
});

test('auth-required opens the prompt and the header rides exactly one retry', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED'), { landed: true }]);
  const prompt = scriptedPrompt([RIGHT_CODE]);
  const value = await gate.runGatedRequest(send, prompt, 'ARM (Live Touch takeover)');
  assert.deepEqual(value, { landed: true });
  assert.equal(calls.length, 2, 'exactly one retry, no replay storm');
  assert.equal(calls[0], null);
  assert.equal(calls[1], RIGHT_CODE);
  assert.equal(prompt.asked.length, 1);
  assert.equal(prompt.asked[0].what, 'ARM (Live Touch takeover)');
  assert.equal(prompt.closeCount(), 1);
});

test('two ARMs ask twice — nothing is remembered between attempts', async () => {
  const { gate } = loadModule();
  const first = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED'), { landed: 1 }]);
  const firstPrompt = scriptedPrompt([RIGHT_CODE]);
  await gate.runGatedRequest(first.send, firstPrompt, 'ARM');

  const second = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED'), { landed: 2 }]);
  const secondPrompt = scriptedPrompt([RIGHT_CODE]);
  await gate.runGatedRequest(second.send, secondPrompt, 'ARM');

  assert.equal(firstPrompt.asked.length, 1);
  assert.equal(secondPrompt.asked.length, 1, 'the second ARM must ask again — EVERY TIME');
  assert.deepEqual(second.calls, [null, RIGHT_CODE],
    'the second takeover still starts passcode-free; nothing was cached');
});

test('cancel issues no retry and reports a cancellation, not a fault', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED')]);
  const prompt = scriptedPrompt([null]);
  await assert.rejects(
    gate.runGatedRequest(send, prompt, 'ARM'),
    (error) => {
      assert.equal(error.takeoverCancelled, true);
      assert.match(error.message, /stays DISARMED/);
      return true;
    },
  );
  assert.deepEqual(calls, [null], 'a cancelled prompt must not retry the request');
  assert.equal(prompt.closeCount(), 1);
});

test('a rejected passcode keeps the sheet open and retries in place', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([
    refusal('TAKEOVER_AUTH_REQUIRED'),
    refusal('TAKEOVER_AUTH_INVALID'),
    { landed: true },
  ]);
  const prompt = scriptedPrompt([WRONG_CODE, RIGHT_CODE]);
  await gate.runGatedRequest(send, prompt, 'ARM');
  assert.deepEqual(calls, [null, WRONG_CODE, RIGHT_CODE]);
  assert.equal(prompt.asked.length, 2, 'one sheet, two attempts');
  assert.equal(prompt.closeCount(), 1, 'the sheet closes once, on success');
  assert.equal(prompt.asked[0].code, 'TAKEOVER_AUTH_REQUIRED');
  assert.equal(prompt.asked[1].code, 'TAKEOVER_AUTH_INVALID');
  assert.match(prompt.asked[1].reason, /Passcode rejected/);
  prompt.asked.forEach((detail) => {
    assert.doesNotMatch(JSON.stringify(detail), new RegExp(WRONG_CODE),
      'the refusal must never echo the attempt');
  });
});

test('cancelling after a rejection is still a cancellation', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([
    refusal('TAKEOVER_AUTH_REQUIRED'),
    refusal('TAKEOVER_AUTH_INVALID'),
  ]);
  const prompt = scriptedPrompt([WRONG_CODE, null]);
  await assert.rejects(gate.runGatedRequest(send, prompt, 'ARM'),
    (error) => error.takeoverCancelled === true);
  assert.deepEqual(calls, [null, WRONG_CODE]);
});

test('a non-passcode failure closes the sheet and surfaces normally', async () => {
  const { gate } = loadModule();
  const locked = new Error('POST /layers/activate → 423 PortWatch owns the rig');
  const { send } = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED'), locked]);
  const prompt = scriptedPrompt([RIGHT_CODE]);
  await assert.rejects(gate.runGatedRequest(send, prompt, 'ARM'), /PortWatch owns the rig/);
  assert.equal(prompt.closeCount(), 1);
  assert.equal(prompt.asked.length, 1, 'the operator is not asked to retype against a lock');
});

test('a gate that cannot render its prompt refuses the takeover out loud', async () => {
  const { gate } = loadModule();
  const { send, calls } = recordingSend([refusal('TAKEOVER_AUTH_REQUIRED')]);
  await assert.rejects(
    gate.runGatedRequest(send, null, 'ARM'),
    /cannot render the passcode prompt — refusing the takeover/,
  );
  assert.deepEqual(calls, [null], 'never proceeds unauthenticated');
});

// ── storage audit ──────────────────────────────────────────────────────────
test('a completed flow leaves the passcode in no storage, export, or log', async () => {
  const { gate, storageCalls, consoleCalls } = loadModule();
  const { send } = recordingSend([
    refusal('TAKEOVER_AUTH_REQUIRED'),
    refusal('TAKEOVER_AUTH_INVALID'),
    { landed: true },
  ]);
  await gate.runGatedRequest(send, scriptedPrompt([WRONG_CODE, RIGHT_CODE]), 'ARM');

  assert.deepEqual(storageCalls, [], 'localStorage/sessionStorage must be untouched');
  assert.deepEqual(consoleCalls, [], 'nothing about a takeover attempt is logged');
  const exported = JSON.stringify(Object.keys(gate).map((key) => String(gate[key])));
  assert.doesNotMatch(exported, new RegExp(RIGHT_CODE));
  assert.doesNotMatch(exported, new RegExp(WRONG_CODE));
});

test('neither the gate nor the wire can persist, log, or forward a passcode', () => {
  // Matched against CALLS, not prose: both files discuss these APIs in their
  // comments precisely because they must never invoke them.
  const STORAGE_CALL = /localStorage\s*[.[]|sessionStorage\s*[.[]|indexedDB\s*[.[]|document\.cookie/;
  [['gate', moduleSource], ['wire', wireSource]].forEach(([name, source]) => {
    assert.equal(STORAGE_CALL.test(source), false,
      `${name}: no storage API may be called anywhere on the passcode path`);
  });
  assert.equal(/\.postMessage\s*\(/.test(moduleSource), false,
    'the passcode lives inside this iframe and never crosses the frame boundary');
  // The wire still owns the host bridge (the surface-release handoff ack) — it
  // just goes through the shared embed transport since _252 rather than a raw
  // `window.parent.postMessage`, so the iPad's WebView speaks it too. Either
  // way, never with a passcode: no bridge payload and no URL may mention the
  // header.
  const bridgeBlocks = wireSource.match(/embed\.post\([\s\S]{0,400}?\}\)/g) || [];
  assert.ok(bridgeBlocks.length > 0, 'the wire still owns the host bridge');
  bridgeBlocks.forEach((block) => {
    assert.doesNotMatch(block, /passcode/i);
  });
  assert.doesNotMatch(wireSource, /searchParams\.set|\?passcode|&passcode/i);
});

// ── the rendered prompt ────────────────────────────────────────────────────
test('the prompt is a big-thumb secure sheet inside this document', () => {
  const { gate } = loadModule();
  const doc = makeDocument();
  const prompt = gate.createPrompt(doc);

  assert.equal(prompt.input.type, 'password');
  assert.equal(prompt.input.getAttribute('autocomplete'), 'off');
  assert.equal(prompt.input.getAttribute('spellcheck'), 'false');
  assert.equal(prompt.element.getAttribute('aria-modal'), 'true');
  assert.equal(prompt.element.getAttribute('role'), 'dialog');
  assert.equal(prompt.errorBox.getAttribute('role'), 'alert');
  assert.ok(gate.INPUT_HEIGHT_PX >= 64, 'night UI: a passcode box you can hit with a thumb');
  assert.ok(gate.BUTTON_HEIGHT_PX >= 56, 'both buttons clear the 44 px touch minimum');
  assert.match(prompt.input.style.cssText, new RegExp(`height:${gate.INPUT_HEIGHT_PX}px`));
  assert.match(prompt.submitButton.style.cssText,
    new RegExp(`min-height:${gate.BUTTON_HEIGHT_PX}px`));
  assert.match(prompt.cancelButton.style.cssText,
    new RegExp(`min-height:${gate.BUTTON_HEIGHT_PX}px`));
  // Above Spatial fullscreen (1000) and the wire's error toast (9999).
  assert.match(prompt.element.style.cssText, /z-index:100000/);
  assert.equal(prompt.isOpen(), false, 'creating the prompt must not attach it');
  assert.equal(doc.body.children.length, 0);
});

test('the prompt clears its box on submit, on cancel and on close', async () => {
  const { gate } = loadModule();
  const doc = makeDocument();
  const prompt = gate.createPrompt(doc);

  const first = prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_REQUIRED', reason: 'because' });
  assert.equal(prompt.isOpen(), true);
  assert.equal(doc.body.children[0], prompt.element);
  assert.ok(prompt.input.focusCount > 0);
  // REQUIRED explains; it does not paint the box red.
  assert.equal(prompt.errorBox.hidden, true);

  prompt.input.value = RIGHT_CODE;
  prompt.submitButton.fire('click');
  assert.equal(await first, RIGHT_CODE);
  assert.equal(prompt.input.value, '', 'the box is wiped the instant it is read');
  assert.equal(prompt.isOpen(), true, 'the sheet stays up until the retry settles');

  const second = prompt.ask({
    what: 'ARM', code: 'TAKEOVER_AUTH_INVALID', reason: 'Passcode rejected.',
  });
  assert.equal(prompt.errorBox.hidden, false);
  assert.equal(prompt.errorBox.textContent, 'Passcode rejected.');
  assert.equal(prompt.input.value, '');
  prompt.input.value = WRONG_CODE;
  prompt.cancelButton.fire('click');
  assert.equal(await second, null);
  assert.equal(prompt.input.value, '', 'cancel discards what was typed');

  prompt.input.value = WRONG_CODE;
  prompt.close();
  assert.equal(prompt.input.value, '');
  assert.equal(prompt.isOpen(), false);
  assert.equal(doc.body.children.length, 0, 'closing detaches the sheet');
});

test('Enter submits, Escape cancels, and an empty submit is refused in place', async () => {
  const { gate } = loadModule();
  const prompt = gate.createPrompt(makeDocument());

  const asked = prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_REQUIRED', reason: 'r' });
  prompt.input.value = '';
  prompt.submitButton.fire('click');
  assert.equal(prompt.errorBox.hidden, false);
  assert.match(prompt.errorBox.textContent, /Type the operator passcode/);
  prompt.input.value = RIGHT_CODE;
  prompt.input.fire('keydown', { key: 'Enter' });
  assert.equal(await asked, RIGHT_CODE);

  const cancelled = prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_INVALID', reason: 'r' });
  prompt.input.fire('keydown', { key: 'Escape' });
  assert.equal(await cancelled, null);
});

test('closing an open prompt resolves its pending ask as a cancel', async () => {
  // A page-lifecycle cancellation or a timeline force-disarm must never leave
  // the ARM chain parked on an operator who is no longer there.
  const { gate } = loadModule();
  const prompt = gate.createPrompt(makeDocument());
  const pending = prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_REQUIRED', reason: 'r' });
  prompt.close();
  assert.equal(await pending, null);
});

test('the prompt refuses to be asked two questions at once', () => {
  const { gate } = loadModule();
  const prompt = gate.createPrompt(makeDocument());
  prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_REQUIRED', reason: 'r' });
  assert.throws(
    () => prompt.ask({ what: 'ARM', code: 'TAKEOVER_AUTH_REQUIRED', reason: 'r' }),
    /already waiting for an answer/,
  );
});

test('a document with no body cannot silently skip the prompt', () => {
  const { gate } = loadModule();
  assert.throws(() => gate.createPrompt(null), /no document body/);
  assert.throws(() => gate.createPrompt({ createElement: () => ({}) }), /no document body/);
});

// ── wire + panel wiring ────────────────────────────────────────────────────
test('the panel loads the passcode gate before the wire that depends on it', () => {
  const gateAt = panelSource.indexOf('<script src="touch_control_passcode.js"></script>');
  const wireAt = panelSource.indexOf('document.write(\'<script src="touch_control_wire.js?v=\'');
  assert.ok(gateAt >= 0, 'the panel must load touch_control_passcode.js');
  assert.ok(wireAt > gateAt, 'the gate must exist before the wire installs it');
});

test('only an owner-tagged live_touch activation is routed through the gate', () => {
  const block = wireSource.match(/function activateLayerSetting\([\s\S]*?\n  \}/);
  assert.ok(block, 'activateLayerSetting is missing');
  assert.match(block[0], /target === 'live_touch' && ownerRequired/);
  assert.match(block[0], /takeoverGatedReq\('POST', '\/layers\/activate', body/);
  // The reverse direction is free: handback/idle-sync must keep the plain
  // transports so RESUME can never be held hostage by a passcode.
  assert.match(block[0], /var transport = ownerRequired \? req : unownedReq/);
});

test('the passcode header is attached to exactly one request and nothing else', () => {
  const block = wireSource.match(/function requestJson\([\s\S]*?\n  \}\n/);
  assert.ok(block, 'requestJson is missing');
  assert.match(block[0], /function requestJson\(method, path, body, ownerTagged, passcode\)/);
  assert.match(block[0], /if \(passcode\) opts\.headers\[passcodeModule\(\)\.HEADER\] = passcode/);
  assert.match(block[0], /refusalFromResponse\(r\.status, t\)/);
  // One call site supplies a passcode, and it is the gated retry.
  const withPasscode = wireSource.match(/(?<!function )requestJson\([^\n]*passcode\)/g) || [];
  assert.equal(withPasscode.length, 1);
  assert.match(withPasscode[0], /requestJson\(method, path, body, true, passcode\)/);
});

test('ARM refuses out loud when the passcode gate did not load', () => {
  const block = wireSource.match(/function armLiveTouch\(\)[\s\S]*?\n  \}\n/);
  assert.ok(block, 'armLiveTouch is missing');
  assert.match(block[0], /if \(!window\.TouchControlPasscode\)/);
  assert.match(block[0], /ARM is refused/);
  // The refusal must land BEFORE the deadman lease is acquired.
  assert.ok(block[0].indexOf('TouchControlPasscode') < block[0].indexOf('acquireLease'));
});

test('an abandoned prompt is torn down by every path that ends the ARM', () => {
  assert.match(wireSource, /function closeTakeoverPrompt\(\)/);
  const forceDisarm = wireSource.match(/function forceDisarmedUi\(\)[\s\S]*?\n  \}/);
  assert.ok(forceDisarm, 'forceDisarmedUi is missing');
  assert.match(forceDisarm[0], /closeTakeoverPrompt\(\)/);
  const pageShow = wireSource.match(/window\.addEventListener\('pageshow'[\s\S]*?\n  \}\);/);
  assert.ok(pageShow, 'pageshow recovery handler is missing');
  assert.match(pageShow[0], /closeTakeoverPrompt\(\)/);
});

test('a refused background write points at ARM instead of opening a modal', () => {
  // The engine also refuses the IMPLICIT re-takeover on any owner-tagged
  // mutation. A fader mid-drag must not raise a passcode sheet; it must say so.
  assert.match(wireSource, /function describeTakeoverRefusal\(error\)/);
  assert.match(wireSource, /fail\('write', describeTakeoverRefusal\(e\)\)/);
  assert.match(wireSource, /press '\s*\n?\s*\+ 'ARM to take over with an operator passcode/);
});
