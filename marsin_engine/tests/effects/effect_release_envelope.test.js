/**
 * tests/effects/effect_release_envelope.test.js
 *
 * The GENERALIZED effect RELEASE envelope (docs/57 §2.2, report `_240`).
 *
 * `setEffect(name, false, { releaseMs, releaseTo })` ramps a slam's boost
 * 1.0 → 0 instead of dropping it on the next frame. Two targets:
 *
 *   show  px.c = max(px.c, env)  — the running pattern RISES THROUGH the flash
 *   dark  px.c = env             — the flash decays to black over the content
 *
 * What these tests pin:
 *   • every releasable slam (blastWhite, uvBlast, vintageWhite) rides the same
 *     linear, self-retiring envelope on every channel it owns while lit;
 *   • `show` never dims live pattern content, `dark` always reaches black;
 *   • a retrigger snaps back to full and cancels the ramp;
 *   • an idle rig pays nothing (no entries, no pixel writes);
 *   • the bypass-dimmer flags are held through the release exactly as during
 *     the hold, so the exit does not jump brightness;
 *   • two-argument callers are unchanged, and vintageWhite with no opts still
 *     rides its configured `vintageWhiteReleaseMs`;
 *   • out-of-range / unknown release options are REFUSED, never clamped or
 *     ignored (codex P0).
 *
 * The clock is injected on BOTH the falling edge (`opts.nowMs`) and the frame
 * (`applyPixels(px, nowMs)`), so nothing here sleeps.
 *
 * Run:  node --test tests/effects/effect_release_envelope.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GlobalEffectsController,
  RELEASABLE_EFFECTS,
  EFFECT_RELEASE_MS_MAX,
} from '../../lib/global_effects_controller.js';

const EPS = 1e-9;
const near = (a, b, what) => assert.ok(Math.abs(a - b) < EPS, `${what}: ${a} !== ${b}`);

/**
 * A full-featured RGBWA+U pixel plus a VintageLed head, matching the frame
 * model in engine.js: every tick rewrites the pixels from the mixer output and
 * THEN calls applyPixels, so each frame starts from fresh pattern values.
 *
 * `base` is what the pattern wrote this frame.
 */
function makePixels(base = {}) {
  const b = { r: 0, g: 0, b: 0, w: 0, a: 0, u: 0, ...base };
  return [
    {
      name: 'par_1', fixtureType: 'Par',
      channels: { r: 1, g: 1, b: 1, w: 1, a: 1, u: 1 },
      r: b.r, g: b.g, b: b.b, w: b.w, a: b.a, u: b.u,
    },
    {
      name: 'vintage_head_1', fixtureType: 'VintageLed',
      channels: { w: 1 },
      r: 0, g: 0, b: 0, w: b.w, a: 0, u: 0,
    },
  ];
}

function frame(c, nowMs, base = {}) {
  const px = makePixels(base);
  c.applyPixels(px, nowMs);
  return px;
}

// ── blastWhite: the reveal / THE KISS flash ─────────────────────────────────

test('blastWhite releaseTo:show decays EVERY channel it owned and never dims the pattern', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  const lit = frame(c, 0);
  assert.deepEqual(
    [lit[0].r, lit[0].g, lit[0].b, lit[0].w, lit[0].a], [1, 1, 1, 1, 1],
    'the hold is unchanged: every channel slammed');

  c.setEffect('blastWhite', false, { releaseMs: 700, releaseTo: 'show', nowMs: 1000 });

  // Linear decay, on every channel the slam owned.
  for (const [t, env] of [[1000, 1.0], [1175, 0.75], [1350, 0.5], [1525, 0.25]]) {
    const px = frame(c, t);
    for (const ch of ['r', 'g', 'b', 'w', 'a']) near(px[0][ch], env, `t=${t} ${ch}`);
  }

  // The show underneath RISES THROUGH: a pattern value brighter than the
  // envelope survives, a dimmer one is lifted to it.
  const mid = frame(c, 1350, { r: 0.9, g: 0.1 });
  near(mid[0].r, 0.9, 'the pattern wins where it is brighter');
  near(mid[0].g, 0.5, 'and is lifted to the boost where it is dimmer');

  // Retires itself at the end and costs nothing after.
  const done = frame(c, 1700, { r: 0.3 });
  near(done[0].r, 0.3, 'the ramp is done — the pattern owns the pixel');
  assert.equal(c._fxRelease.blastWhite, null, 'the entry retired itself');
});

test('blastWhite releaseTo:dark replace-decays to black over BRIGHT content', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  frame(c, 0);
  c.setEffect('blastWhite', false, { releaseMs: 400, releaseTo: 'dark', nowMs: 0 });

  // A bright pattern underneath is MASKED for the whole release — that is the
  // authored intent of `dark` (docs/57 §2.2), not a fallback.
  const half = frame(c, 200, { r: 1.0, g: 0.8, b: 0.6 });
  near(half[0].r, 0.5, 'dark replaces rather than raising');
  near(half[0].g, 0.5, 'even where the pattern is brighter');
  near(half[0].b, 0.5, 'on every channel');

  const almost = frame(c, 399, { r: 1.0 });
  assert.ok(almost[0].r > 0 && almost[0].r < 0.01, 'the release reaches (near) black');

  // At env = 0 the entry retires and the pattern owns the pixel again.
  const after = frame(c, 400, { r: 1.0 });
  near(after[0].r, 1.0, 'content pops back once the envelope retires');
  assert.equal(c._fxRelease.blastWhite, null);
});

test('a blastWhite retrigger mid-release snaps back to full and cancels the ramp', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  frame(c, 0);
  c.setEffect('blastWhite', false, { releaseMs: 800, releaseTo: 'show', nowMs: 0 });
  near(frame(c, 400)[0].r, 0.5, 'halfway out');

  c.setEffect('blastWhite', true);
  assert.equal(c._fxRelease.blastWhite, null, 'the ramp is cancelled outright');
  near(frame(c, 410)[0].r, 1.0, 'snapped back to full');

  // ...and the NEXT release starts a fresh full-length ramp.
  c.setEffect('blastWhite', false, { releaseMs: 800, releaseTo: 'show', nowMs: 500 });
  near(frame(c, 900)[0].r, 0.5, 'a fresh 800 ms ramp, halfway');
});

test('blastWhite holds its bypass-dimmer flags through the whole release', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhiteBypassDimmer', true);
  c.setEffect('blastWhite', true);
  const lit = frame(c, 0);
  assert.equal(lit[0].ignoreDimmerForRGB, true);

  c.setEffect('blastWhite', false, { releaseMs: 600, releaseTo: 'show', nowMs: 0 });
  const fading = frame(c, 300);
  near(fading[0].r, 0.5, 'mid-ramp');
  assert.equal(fading[0].ignoreDimmerForRGB, true,
    'the ramp keeps the dimmer treatment it had while lit — otherwise the release '
    + 'would jump brightness at the falling edge');
  assert.equal(fading[0].ignoreDimmerForW, true);
  assert.equal(fading[0].ignoreDimmerForA, true);
});

// ── uvBlast ─────────────────────────────────────────────────────────────────

test('uvBlast releases on the u channel only, both targets', () => {
  const c = new GlobalEffectsController();
  c.setEffect('uvBlast', true);
  assert.equal(frame(c, 0)[0].u, 1.0);

  c.setEffect('uvBlast', false, { releaseMs: 800, releaseTo: 'show', nowMs: 0 });
  const px = frame(c, 400, { u: 0.1, r: 0.7 });
  near(px[0].u, 0.5, 'u decays');
  near(px[0].r, 0.7, 'and nothing else is touched');

  near(frame(c, 400, { u: 0.9 })[0].u, 0.9, 'show never dims live UV content');

  c.setEffect('uvBlast', true);
  frame(c, 401);
  c.setEffect('uvBlast', false, { releaseMs: 800, releaseTo: 'dark', nowMs: 401 });
  near(frame(c, 801, { u: 0.9 })[0].u, 0.5, 'dark replaces it');
});

// ── vintageWhite: unchanged unless asked ────────────────────────────────────

test('vintageWhite with NO opts still rides its configured fire-sync release', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  frame(c, 0);
  c.setEffect('vintageWhite', false);          // two-arg caller, as the fire path does
  const t0 = c._vwFadeStartMs;
  near(frame(c, t0 + 200)[1].w, 0.5, 'the configured 400 ms ramp, halfway');
  assert.equal(c.getStatus().vintageWhiteReleasing, true, 'and it still reports as releasing');
});

test('an explicit releaseMs wins for that one call and leaves the fire-sync setting alone', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  frame(c, 0);
  c.setEffect('vintageWhite', false, { releaseMs: 1000, nowMs: 0 });
  near(frame(c, 500)[1].w, 0.5, 'the CALL says 1000 ms, so halfway is 500 ms in');
  assert.equal(c.vintageWhiteReleaseMs, 400, 'the configured fire-sync value is untouched');
});

// ── idle cost, defaults, and the two-arg contract ───────────────────────────

test('an idle rig has no envelopes and applyPixels leaves the pattern alone', () => {
  const c = new GlobalEffectsController();
  for (const name of RELEASABLE_EFFECTS) {
    assert.equal(c._fxRelease[name], null, `${name} starts with no envelope`);
    assert.equal(c._releaseEnvelope(name, 1234), null, 'and computes none');
  }
  const px = frame(c, 1234, { r: 0.4, g: 0.3, w: 0.2, u: 0.1 });
  assert.deepEqual(
    [px[0].r, px[0].g, px[0].w, px[0].u], [0.4, 0.3, 0.2, 0.1],
    'nothing is written');
  const status = c.getStatus().effectReleases;
  assert.deepEqual(status, { vintageWhite: null, blastWhite: null, uvBlast: null });
});

test('a two-arg setEffect (and releaseMs 0) is the historical hard cut', () => {
  for (const opts of [undefined, { releaseMs: 0 }, { releaseMs: 0, releaseTo: 'dark' }]) {
    const c = new GlobalEffectsController();
    c.setEffect('blastWhite', true);
    frame(c, 0);
    if (opts === undefined) c.setEffect('blastWhite', false);
    else c.setEffect('blastWhite', false, { ...opts, nowMs: 0 });
    const px = frame(c, 1, { r: 0.2 });
    near(px[0].r, 0.2, `opts=${JSON.stringify(opts)}: gone on the very next frame`);
    assert.equal(c._fxRelease.blastWhite, null);
  }
});

test('releaseTo defaults to show', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  frame(c, 0);
  c.setEffect('blastWhite', false, { releaseMs: 400, nowMs: 0 });
  near(frame(c, 200, { r: 0.9 })[0].r, 0.9, 'default target does not dim the show');
});

// ── refusals (codex P0: never clamp, never ignore) ──────────────────────────

test('an out-of-range or non-numeric releaseMs is REFUSED', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  for (const bad of [-1, EFFECT_RELEASE_MS_MAX + 1, '700', NaN, Infinity, null]) {
    assert.throws(
      () => c.setEffect('blastWhite', false, { releaseMs: bad }),
      /releaseMs must be a number in \[0, 5000\]/,
      `releaseMs=${JSON.stringify(bad)} must throw`);
  }
  assert.equal(c.effects.blastWhite, true, 'and nothing was applied');
  c.setEffect('blastWhite', false, { releaseMs: EFFECT_RELEASE_MS_MAX, nowMs: 0 });
  assert.equal(c._fxRelease.blastWhite.releaseMs, EFFECT_RELEASE_MS_MAX, 'the bound itself is legal');
});

test('an unknown releaseTo is REFUSED', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  assert.throws(
    () => c.setEffect('blastWhite', false, { releaseMs: 400, releaseTo: 'black' }),
    /releaseTo must be 'show' or 'dark'/);
});

test('a release asked for on an effect that has none is REFUSED', () => {
  const c = new GlobalEffectsController();
  for (const name of ['fogger', 'horn', 'fire']) {
    assert.throws(
      () => c.setEffect(name, false, { releaseMs: 400 }),
      /has no release envelope/,
      `${name} must refuse a release`);
  }
});

test('_vwFadeActive cannot be forced true — a release needs a start time', () => {
  const c = new GlobalEffectsController();
  assert.throws(() => { c._vwFadeActive = true; }, /needs a start time/);
  c._vwFadeActive = false;                       // the documented way to cancel
  assert.equal(c._fxRelease.vintageWhite, null);
});

// ── the status window the offline walk reads ────────────────────────────────

test('getStatus reports the live envelope without retiring it', () => {
  const c = new GlobalEffectsController();
  c.setEffect('blastWhite', true);
  c.setEffect('blastWhite', false, { releaseMs: 1000, releaseTo: 'dark', nowMs: 0 });
  const s = c._releaseStatus(250);
  near(s.blastWhite.env, 0.75, 'env');
  assert.equal(s.blastWhite.releaseTo, 'dark');
  assert.equal(s.blastWhite.remainingMs, 750);
  assert.notEqual(c._fxRelease.blastWhite, null, 'a read never retires the entry');
  assert.equal(c._releaseStatus(1000).blastWhite, null, 'and reports null once elapsed');
});
