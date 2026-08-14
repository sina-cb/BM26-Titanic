/**
 * spotlight_pool_budget.test.js — the `?spotlights=` / "Max Spotlights"
 * precedence chain, pinned end to end.
 *
 * Report 20260806_186 audited the chain and found three deviations from the
 * one rule the operator asked for ("the URL param must be authoritative"):
 *
 *   D2  Without `?spotlights=`, the pool was sized from a MODULE-LOAD constant
 *       (60). A scene saved with `maxSpotlights: 150` booted with a slider
 *       reading 150, a pool of 60, and a per-frame limit silently clamped to
 *       60. The slider lied.
 *   D3  A `?spotlights=` session persisted into the scene file on save, and
 *       then — because of D2 — did not round-trip: the saved 200 came back as
 *       an effective 60 on the next plain boot. The save lied.
 *   D4  The URL handling lived inside initLightPool() and wrote only `params`,
 *       not the config tree, diverging from url_overrides.js (the module that
 *       exists precisely to be the one authority for boot URL overrides).
 *
 * The chain now is: scene YAML → applyBootUrlOverrides(?spotlights=N) →
 * initLightPool() sizes the pool from the RESOLVED params.maxSpotlights →
 * setupGUI() binds a slider whose range is that pool. One number, one owner,
 * no silent clamps. These tests run offline — no browser, no ports, no scene
 * writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { params, configTree, setConfigTree, setScene, setModelRadius } from '../src/core/state.js';
import {
  applyBootUrlOverrides,
  buildSpotlightOverCapPrompt,
  resolveSpotlightsUrlValue,
} from '../src/core/url_overrides.js';
import {
  MAX_SPOTLIGHT_POOL_SIZE,
  SPOTLIGHT_ABSOLUTE_CEILING,
  clampPersistedSpotlightBudget,
  clearSpotlightSessionCeiling,
  getSpotlightSessionCeiling,
  isSpotlightSessionCeilingRaised,
  raiseSpotlightSessionCeiling,
  resolveBootPoolSize,
} from '../src/core/light_pool.js';

const SCENE_SAVED_VALUE = 60; // scenes/titanic/scene_config.yaml → parLights.maxSpotlights

// ── Boot harness ────────────────────────────────────────────────────────
// A scene config tree with the one entry this chain cares about, plus the
// `extractParams` step that copies its value into the live params object.
function bootScene(savedValue) {
  // A boot always starts at the hard cap — an accepted over-cap ceiling is
  // session state and must never leak from one boot (or one test) to the next.
  clearSpotlightSessionCeiling();
  setConfigTree({
    parLights: {
      maxSpotlights: { value: savedValue, label: 'Max Spotlights', min: 1, max: 200, step: 1 },
    },
  });
  params.maxSpotlights = savedValue;
  // initLightPool() also validates the sampling strategy at boot (see
  // spotlight_sampling.js — an unknown or missing strategy is refused loudly,
  // never silently defaulted). Every real scene gets this from common.yaml via
  // extractParams; this harness has to supply it too.
  params.spotlightSamplingMode = 'uniform';
}

// ── Over-cap prompt stubs ───────────────────────────────────────────────
// The prompt is dependency-injected precisely so the boot gate can be driven
// headless. Each stub records what it was asked, so a test can assert that a
// value at or under the cap is NEVER put to the operator.
function promptSpy(answer) {
  const spy = {
    calls: [],
    fn: (requested) => {
      spy.calls.push(requested);
      if (typeof answer === 'function') return answer(requested);
      return answer;
    },
  };
  return spy;
}

// The one thing that must never happen: an over-cap budget applied without an
// explicit yes. Any test that is not specifically about the accept path uses
// this, so an accidental auto-accept anywhere would fail loudly.
function neverAsked() {
  return promptSpy(() => {
    throw new Error('the over-cap prompt must not be reached for this input');
  });
}

// Simulate a save: reconstructYAML copies params → the config tree entry, then
// the persistence boundary clamps what actually reaches disk.
function simulateSave() {
  configTree.parLights.maxSpotlights.value = params.maxSpotlights;
  captureConsole(() => clampPersistedSpotlightBudget(configTree));
  return configTree.parLights.maxSpotlights.value;
}

// Capture the loud channels so a test can assert that a refusal/clamp actually
// reached the operator instead of happening silently.
function captureConsole(fn) {
  const captured = { log: [], warn: [], error: [] };
  const real = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => captured.log.push(a.join(' '));
  console.warn = (...a) => captured.warn.push(a.join(' '));
  console.error = (...a) => captured.error.push(a.join(' '));
  try {
    fn();
  } finally {
    Object.assign(console, real);
  }
  return captured;
}

// A boot of the sim's light rig, minus the browser: a fresh light_pool module
// instance (the pool is a one-shot module singleton), a stub scene, and the
// real THREE.SpotLight allocation loop.
let _bootCounter = 0;
async function bootLightPool() {
  const added = [];
  setScene({
    add: (obj) => added.push(obj),
    traverse: (cb) => added.forEach(cb),
  });
  setModelRadius(50);
  const mod = await import(`../src/core/light_pool.js?boot=${++_bootCounter}`);
  captureConsole(() => mod.initLightPool());
  return mod;
}

async function importFreshLightPool(sceneOverride) {
  setScene(sceneOverride);
  setModelRadius(50);
  return import(`../src/core/light_pool.js?boot=${++_bootCounter}`);
}

// The per-frame active limit, as light_pool computes it (clamped to the pool).
function activeLimit(poolSize) {
  return THREE.MathUtils.clamp(Math.floor(Number(params.maxSpotlights)), 0, poolSize);
}

// ── The pure resolver ───────────────────────────────────────────────────

test('?spotlights= accepts an integer budget and reports it verbatim', () => {
  assert.deepEqual(resolveSpotlightsUrlValue('120'), {
    ok: true, value: 120, requested: 120, capped: false,
  });
  assert.deepEqual(resolveSpotlightsUrlValue('0'), {
    ok: true, value: 0, requested: 0, capped: false,
  }, '?spotlights=0 is the documented way to disable the pooled preview');
  assert.equal(resolveSpotlightsUrlValue(' 80 ').value, 80, 'surrounding whitespace is not a typo');
});

test('the cap is a clamp, and it says so — 644 can never mean 644', () => {
  const resolved = resolveSpotlightsUrlValue('644');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(resolved.requested, 644);
  assert.equal(resolved.capped, true, 'the clamp is reported, never silent');
  assert.equal(MAX_SPOTLIGHT_POOL_SIZE, 200, 'raising the GPU cap is an operator ruling, not a fix');
});

test('a malformed budget is refused, not coerced (codex P0: no fallbacks)', () => {
  for (const bad of ['', 'abc', '80px', '1.5', '8e1', 'NaN', '--5']) {
    const resolved = resolveSpotlightsUrlValue(bad);
    assert.equal(resolved.ok, false, `?spotlights='${bad}' must be refused`);
    assert.ok(resolved.reason, 'a refusal always carries a reason to log');
  }
});

test('a negative budget is refused rather than quietly floored to 0', () => {
  // The old module-load parse did `Math.max(0, raw)` — `?spotlights=-5` became
  // a silently disabled pool. A typo must not blackout the analytic rig.
  const resolved = resolveSpotlightsUrlValue('-5');
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /negative/);
});

// ── Precedence: URL beats saved, saved beats nothing ────────────────────

test('URL beats the saved scene value, in BOTH params and the config tree (D4)', () => {
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=120')));

  assert.equal(params.maxSpotlights, 120, 'URL is authoritative at boot');
  assert.equal(configTree.parLights.maxSpotlights.value, 120,
    'the config tree is synced too — the GUI and the save path must agree with params');
});

test('without ?spotlights=, the saved scene value survives untouched', () => {
  bootScene(150);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?profile=full')));

  assert.equal(params.maxSpotlights, 150);
  assert.equal(configTree.parLights.maxSpotlights.value, 150);
});

test('an invalid ?spotlights= keeps the saved value and says so out loud', () => {
  bootScene(SCENE_SAVED_VALUE);
  const captured = captureConsole(
    () => applyBootUrlOverrides(new URLSearchParams('?spotlights=lots'))
  );

  assert.equal(params.maxSpotlights, SCENE_SAVED_VALUE, 'the YAML value is kept');
  assert.equal(configTree.parLights.maxSpotlights.value, SCENE_SAVED_VALUE);
  assert.equal(captured.error.length, 1, 'exactly one loud refusal');
  assert.match(captured.error[0], /Ignoring invalid \?spotlights='lots'/);
});

test('a DECLINED over-cap ?spotlights= is applied clamped, loudly — 200, not 644', () => {
  bootScene(SCENE_SAVED_VALUE);
  const ask = promptSpy(false);
  const captured = captureConsole(
    () => applyBootUrlOverrides(new URLSearchParams('?spotlights=644'),
      { confirmSpotlightOverCap: ask.fn })
  );

  assert.deepEqual(ask.calls, [644], 'the operator was asked exactly once, with the real number');
  assert.equal(params.maxSpotlights, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(configTree.parLights.maxSpotlights.value, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(isSpotlightSessionCeilingRaised(), false, 'a no leaves the hard cap in place');
  assert.equal(captured.error.length, 1, 'the clamp is an error-level notice, never silent');
  assert.match(captured.error[0], /exceeds the preview pool cap \(200\)\. Using 200\./);
});

test('the other boot overrides are untouched by the new one', () => {
  bootScene(SCENE_SAVED_VALUE);
  setConfigTree({
    ...configTree,
    options: { lightingProfile: { value: 'edit' } },
    colorWave: { lightingMode: { value: 'gradient' } },
  });
  captureConsole(() => applyBootUrlOverrides(
    new URLSearchParams('?profile=full&lighting_mode=sacn_in&spotlights=90')
  ));

  assert.equal(params.lightingProfile, 'full');
  assert.equal(params.lightingMode, 'sacn_in');
  assert.equal(params.maxSpotlights, 90);
});

// ── The pool is sized from the resolved value (D2) ──────────────────────

test('resolveBootPoolSize is the single clamp: 0..cap, integer', () => {
  assert.equal(resolveBootPoolSize(60), 60);
  assert.equal(resolveBootPoolSize(150), 150, 'the D2 case: 150 is allocatable, not silently 60');
  assert.equal(resolveBootPoolSize(644), MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(resolveBootPoolSize(0), 0);
  assert.equal(resolveBootPoolSize(-5), 0);
  assert.equal(resolveBootPoolSize(12.9), 12, 'a pool has whole slots');
});

test('a missing / malformed maxSpotlights crashes the pool instead of inventing 60', () => {
  assert.throws(() => resolveBootPoolSize(undefined), TypeError);
  assert.throws(() => resolveBootPoolSize(null), TypeError);
  assert.throws(() => resolveBootPoolSize('sixty'), TypeError);
});

test('initLightPool rethrows an invalid boot budget instead of reporting a false successful boot', async () => {
  bootScene(60);
  delete params.maxSpotlights;
  const scene = new THREE.Scene();
  const pool = await importFreshLightPool(scene);

  assert.throws(
    () => captureConsole(() => pool.initLightPool()),
    (err) => err instanceof TypeError && /maxSpotlights/.test(err.message)
  );
  assert.equal(pool.isPoolInitialized(), false);
  assert.equal(pool.getPoolSize(), 0);
  assert.equal(scene.children.length, 0);
});

test('initLightPool removes partial allocations and rethrows the original allocation failure', async () => {
  bootScene(3);
  const scene = new THREE.Scene();
  const realAdd = scene.add.bind(scene);
  let addCount = 0;
  scene.add = (...objects) => {
    for (const object of objects) {
      addCount += 1;
      if (addCount === 4) throw new Error('forced target allocation failure');
      realAdd(object);
    }
    return scene;
  };
  const pool = await importFreshLightPool(scene);

  assert.throws(
    () => captureConsole(() => pool.initLightPool()),
    /forced target allocation failure/
  );
  assert.equal(pool.isPoolInitialized(), false);
  assert.equal(pool.getPoolSize(), 0);
  assert.equal(scene.children.length, 0, 'partial SpotLights and targets must be detached');
});

test('D2, fixed: a scene saved at 150 boots a pool of 150 with NO url param', async () => {
  bootScene(150);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('')));
  const pool = await bootLightPool();

  assert.equal(pool.getPoolSize(), 150, 'the saved value now allocates the slots it promises');
  assert.equal(activeLimit(pool.getPoolSize()), 150,
    'and the per-frame limit is no longer silently clamped down to 60');
  assert.equal(pool.getSpotlightSliderMax(), 150, 'the slider range equals the pool — no dead travel');
});

test('the URL boot allocates exactly what the URL resolved to', async () => {
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=644')));
  const pool = await bootLightPool();

  assert.equal(pool.getPoolSize(), MAX_SPOTLIGHT_POOL_SIZE, 'the operator’s 644 boot: 200 real SpotLights');
  assert.equal(pool.getRequestedPoolSize(), MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(activeLimit(pool.getPoolSize()), MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(pool.getSpotlightSliderMax(), MAX_SPOTLIGHT_POOL_SIZE);
});

test('?spotlights=0 still disables the pool entirely', async () => {
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=0')));
  const pool = await bootLightPool();

  assert.equal(pool.getPoolSize(), 0);
  assert.equal(activeLimit(pool.getPoolSize()), 0, 'no slot can be lit, whatever the slider says');
});

test('the slider can never promise travel the pool cannot honour', async () => {
  for (const saved of [1, 37, SCENE_SAVED_VALUE, 150, MAX_SPOTLIGHT_POOL_SIZE]) {
    bootScene(saved);
    captureConsole(() => applyBootUrlOverrides(new URLSearchParams('')));
    const pool = await bootLightPool();
    assert.equal(pool.getSpotlightSliderMax(), pool.getPoolSize(),
      `slider max must equal the pool for a saved value of ${saved}`);
    // Every reachable slider position is a position the pool can actually serve.
    params.maxSpotlights = pool.getSpotlightSliderMax();
    assert.equal(activeLimit(pool.getPoolSize()), pool.getPoolSize());
  }
});

// ── D3: the save round-trips truthfully ─────────────────────────────────

test('D3, fixed: boot with ?spotlights=, save, reboot plain — same pool, same limit', async () => {
  // Boot 1: URL session at the cap over a scene saved at 60.
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=644')));
  const firstBoot = await bootLightPool();
  assert.equal(firstBoot.getPoolSize(), MAX_SPOTLIGHT_POOL_SIZE);

  // Save: reconstructYAML copies params back into the config tree entry.
  // (maxSpotlights carries no `transient` flag — persist-on-save matches the
  // lightingMode / lightingProfile precedent.)
  configTree.parLights.maxSpotlights.value = params.maxSpotlights;
  const persisted = configTree.parLights.maxSpotlights.value;
  assert.equal(persisted, MAX_SPOTLIGHT_POOL_SIZE, 'the session value is what gets written');

  // Boot 2: the saved scene, no URL param at all.
  bootScene(persisted);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('')));
  const secondBoot = await bootLightPool();

  assert.equal(secondBoot.getPoolSize(), firstBoot.getPoolSize(),
    'the persisted value reproduces the same pool — the save no longer lies');
  assert.equal(activeLimit(secondBoot.getPoolSize()), MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(secondBoot.getSpotlightSliderMax(), MAX_SPOTLIGHT_POOL_SIZE);
});

test('a plain boot of the shipped titanic value is unchanged (no regression at 60)', async () => {
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?profile=full&lighting_mode=sacn_in')));
  const pool = await bootLightPool();

  assert.equal(pool.getPoolSize(), SCENE_SAVED_VALUE, 'the default scene still boots 60 SpotLights');
  assert.equal(activeLimit(pool.getPoolSize()), SCENE_SAVED_VALUE);
});

// ════════════════════════════════════════════════════════════════════════
// _189 — the over-cap prompt: "ask, and if he says yes, raise it for THIS
// SESSION". The cap stays a cap; what changes is that an operator who knows
// what he is asking for can be told the risk and say yes anyway, once, for
// one page load. Nothing about that yes may survive the reload.
// ════════════════════════════════════════════════════════════════════════

// ── The resolver's third outcome ────────────────────────────────────────

test('over the cap is no longer a silent verdict — it asks, and its value is the DECLINE', () => {
  const resolved = resolveSpotlightsUrlValue('644');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.needsConfirm, true, 'the operator gets a say');
  assert.equal(resolved.requested, 644);
  assert.equal(resolved.value, MAX_SPOTLIGHT_POOL_SIZE,
    'value carries the decline outcome, so a caller that never asks behaves exactly as before');
});

test('at or under the cap there is nothing to ask about', () => {
  for (const raw of ['0', '1', '60', '199', '200']) {
    assert.equal(resolveSpotlightsUrlValue(raw).needsConfirm, undefined,
      `?spotlights=${raw} must never prompt`);
  }
});

test('the absolute ceiling refuses instead of asking — a typo is not a budget', () => {
  assert.equal(SPOTLIGHT_ABSOLUTE_CEILING, 2000,
    'raising the absolute ceiling is an operator ruling, not a fix');

  const absurd = resolveSpotlightsUrlValue('999999');
  assert.equal(absurd.ok, false, 'no prompt, no allocation — refused');
  assert.equal(absurd.requested, 999999);
  assert.match(absurd.reason, /absolute ceiling \(2000\)/);

  assert.equal(resolveSpotlightsUrlValue('2001').ok, false, 'one over the ceiling is still over');
  assert.equal(resolveSpotlightsUrlValue('2000').needsConfirm, true, 'the ceiling itself is askable');
});

test('the prompt states the number, the cap, the GPU risk and the session scope', () => {
  const text = buildSpotlightOverCapPrompt(644);
  assert.match(text, /644/);
  assert.match(text, /safe cap of 200/);
  assert.match(text, /white- or black-screen|~160/, 'the operator is told what can break');
  assert.match(text, /THIS SESSION ONLY/);
  assert.match(text, /next boot asks again/, 'and that the answer is not remembered');
});

// ── Accept ──────────────────────────────────────────────────────────────

test('ACCEPT: the requested budget is applied for this session, in params and the tree', () => {
  bootScene(SCENE_SAVED_VALUE);
  const ask = promptSpy(true);
  const captured = captureConsole(
    () => applyBootUrlOverrides(new URLSearchParams('?spotlights=400'),
      { confirmSpotlightOverCap: ask.fn })
  );

  assert.deepEqual(ask.calls, [400]);
  assert.equal(params.maxSpotlights, 400, 'the operator gets the number he accepted');
  assert.equal(configTree.parLights.maxSpotlights.value, 400);
  assert.equal(getSpotlightSessionCeiling(), 400, 'the session ceiling is raised to exactly N');
  assert.equal(isSpotlightSessionCeilingRaised(), true);
  assert.equal(captured.error.length, 0, 'an accepted budget is not an error');
  assert.equal(captured.warn.length, 1, 'but it IS loud — this is not a normal session');
  assert.match(captured.warn[0], /ACCEPTED by the operator/);
  assert.match(captured.warn[0], /THIS SESSION ONLY/);
});

test('ACCEPT: the pool really allocates N SpotLights, and the slider reaches all of them', async () => {
  bootScene(SCENE_SAVED_VALUE);
  const ask = promptSpy(true);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=260'),
    { confirmSpotlightOverCap: ask.fn }));
  const pool = await bootLightPool();

  assert.equal(pool.getPoolSize(), 260, 'the accepted budget is what gets built');
  assert.equal(pool.getRequestedPoolSize(), 260);
  assert.equal(activeLimit(pool.getPoolSize()), 260);
  assert.equal(pool.getSpotlightSliderMax(), 260,
    'the slider range is the pool, over-cap sessions included — no dead travel, no hidden ceiling');
});

test('ACCEPT is still bounded: the absolute ceiling refuses before anyone is asked', async () => {
  bootScene(SCENE_SAVED_VALUE);
  const ask = neverAsked();
  const captured = captureConsole(
    () => applyBootUrlOverrides(new URLSearchParams('?spotlights=999999'),
      { confirmSpotlightOverCap: ask.fn })
  );

  assert.deepEqual(ask.calls, [], 'no consent is sought for a value that cannot render');
  assert.equal(params.maxSpotlights, SCENE_SAVED_VALUE, 'the scene value is kept');
  assert.equal(isSpotlightSessionCeilingRaised(), false);
  assert.equal(captured.error.length, 1);
  assert.match(captured.error[0], /Ignoring invalid \?spotlights='999999'/);

  const pool = await bootLightPool();
  assert.equal(pool.getPoolSize(), SCENE_SAVED_VALUE, 'nothing absurd was ever allocated');
});

test('raiseSpotlightSessionCeiling refuses anything that is not a bounded raise', () => {
  for (const bad of [200, 60, 0, -1, 2001, 250.5, '250', null, undefined, NaN]) {
    assert.throws(() => raiseSpotlightSessionCeiling(bad), RangeError,
      `raise(${JSON.stringify(bad)}) must throw`);
  }
  raiseSpotlightSessionCeiling(201);
  assert.equal(getSpotlightSessionCeiling(), 201);
  clearSpotlightSessionCeiling();
  assert.equal(getSpotlightSessionCeiling(), MAX_SPOTLIGHT_POOL_SIZE);
});

// ── Decline, and every shape of "not a yes" ─────────────────────────────

test('DECLINE keeps the old behaviour exactly: cap, loud, no raise', async () => {
  bootScene(SCENE_SAVED_VALUE);
  const ask = promptSpy(false);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=400'),
    { confirmSpotlightOverCap: ask.fn }));
  const pool = await bootLightPool();

  assert.equal(params.maxSpotlights, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(pool.getPoolSize(), MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(isSpotlightSessionCeilingRaised(), false);
});

test('anything that is not a clear yes is a no — dismissal, a thrown dialog, junk', () => {
  // A dismissed native confirm() returns false; a broken injection can return
  // undefined or throw. None of those is consent, and consent is the only
  // thing that may raise the cap (codex P0: never fall back to accept).
  for (const answer of [undefined, null, 0, '', 'yes', 1, () => { throw new Error('boom'); }]) {
    bootScene(SCENE_SAVED_VALUE);
    const ask = promptSpy(answer);
    captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=400'),
      { confirmSpotlightOverCap: ask.fn }));

    assert.equal(params.maxSpotlights, MAX_SPOTLIGHT_POOL_SIZE,
      `answer ${String(answer)} must not raise the cap`);
    assert.equal(isSpotlightSessionCeilingRaised(), false);
  }
});

test('no dialog in this context means no consent — the default prompt declines, loudly', () => {
  // Headless render tools boot the same module. Without a confirm() there is
  // nobody to ask, so the answer is no — never a timeout that accepts.
  assert.equal(typeof globalThis.confirm, 'undefined',
    'this test asserts the no-dialog path; a global confirm() would invalidate it');

  bootScene(SCENE_SAVED_VALUE);
  const captured = captureConsole(
    () => applyBootUrlOverrides(new URLSearchParams('?spotlights=400'))
  );

  assert.equal(params.maxSpotlights, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(isSpotlightSessionCeilingRaised(), false);
  assert.match(captured.error.join('\n'), /no confirm\(\) dialog — DECLINING/);
});

// ── Session-only: the raise may never reach disk, or the next boot ───────

test('SESSION-ONLY: saving an accepted over-cap session writes the hard cap, not the raise', () => {
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=400'),
    { confirmSpotlightOverCap: promptSpy(true).fn }));
  assert.equal(params.maxSpotlights, 400);

  const persisted = simulateSave();

  assert.equal(persisted, MAX_SPOTLIGHT_POOL_SIZE,
    'the scene file may never record a budget the next boot would run unasked');
  assert.equal(params.maxSpotlights, 400,
    'and the live session is untouched by the save — it keeps running the 400 it was granted');
});

test('the persistence clamp is loud, and a no-op for every normal session', () => {
  bootScene(150);
  const captured = captureConsole(() => {
    configTree.parLights.maxSpotlights.value = 150;
    assert.equal(clampPersistedSpotlightBudget(configTree), null, 'no-op below the cap');
    assert.equal(configTree.parLights.maxSpotlights.value, 150);

    configTree.parLights.maxSpotlights.value = 400;
    assert.equal(clampPersistedSpotlightBudget(configTree), 400, 'reports what it clamped away');
  });
  assert.equal(configTree.parLights.maxSpotlights.value, MAX_SPOTLIGHT_POOL_SIZE);
  assert.equal(captured.warn.length, 1, 'dropping an operator-visible number is never silent');
  assert.match(captured.warn[0], /session-only/);
});

test('ROUND-TRIP: after an accepted session, the next plain boot is untouched by it', async () => {
  // Boot 1: over-cap, accepted.
  bootScene(SCENE_SAVED_VALUE);
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=260'),
    { confirmSpotlightOverCap: promptSpy(true).fn }));
  const firstBoot = await bootLightPool();
  assert.equal(firstBoot.getPoolSize(), 260);

  // ...and saved, which is where the raise would have leaked.
  const persisted = simulateSave();
  assert.equal(persisted, MAX_SPOTLIGHT_POOL_SIZE);

  // Boot 2: the saved scene, no URL param, nobody asked anything.
  bootScene(persisted);
  const ask = neverAsked();
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams(''),
    { confirmSpotlightOverCap: ask.fn }));
  const secondBoot = await bootLightPool();

  assert.deepEqual(ask.calls, [], 'a plain boot never prompts');
  assert.equal(isSpotlightSessionCeilingRaised(), false, 'the raise did not survive the reload');
  assert.equal(secondBoot.getPoolSize(), MAX_SPOTLIGHT_POOL_SIZE,
    'the next session runs the saved value at the hard cap — 200, not 260');
  assert.equal(secondBoot.getSpotlightSliderMax(), MAX_SPOTLIGHT_POOL_SIZE);
});

test('a hand-edited scene value above the cap is clamped, and still never prompts', async () => {
  // The prompt is a URL-only gate: consent is asked for what the operator just
  // typed, not for a number that was already sitting in a file.
  bootScene(500);
  const ask = neverAsked();
  captureConsole(() => applyBootUrlOverrides(new URLSearchParams(''),
    { confirmSpotlightOverCap: ask.fn }));
  const pool = await bootLightPool();

  assert.deepEqual(ask.calls, []);
  assert.equal(pool.getPoolSize(), MAX_SPOTLIGHT_POOL_SIZE, 'the hard cap still binds the pool');
});

test('every over-cap boot asks again — the answer is never remembered', () => {
  const ask = promptSpy(true);
  for (let boot = 0; boot < 3; boot++) {
    bootScene(SCENE_SAVED_VALUE);
    captureConsole(() => applyBootUrlOverrides(new URLSearchParams('?spotlights=300'),
      { confirmSpotlightOverCap: ask.fn }));
    assert.equal(getSpotlightSessionCeiling(), 300);
  }
  assert.deepEqual(ask.calls, [300, 300, 300],
    'three boots, three prompts — no localStorage, no "don\'t ask again"');
});
