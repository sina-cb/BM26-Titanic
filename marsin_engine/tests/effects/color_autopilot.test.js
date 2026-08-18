import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ColorAutopilot, lerpHue, lerpParams } from '../../lib/color_autopilot.js';

const KNOWN = new Set(['aurora', 'bass_drop', 'deep_sea']);

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colorap-'));
  return path.join(dir, 'config.yaml');
}

// ── static validate (pure, no IO) ───────────────────────────────────────────

test('validate accepts a good wire shape and normalizes shuffle + transitionMs defaults', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2 }, KNOWN);
  // `mode` is now always emitted (docs/59 §4.1): the wire gained a mode
  // discriminator, and a normalizer that left it out would make every legacy
  // config round-trip into an object the follow-note branch has to guess about.
  assert.deepEqual(out, { active: true, mode: 'palettes', palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: false, transitionMs: 0 });
});

test('validate accepts and preserves a non-negative transitionMs', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: ['aurora'], delay_s: 2, transitionMs: 1000 }, KNOWN);
  assert.equal(out.transitionMs, 1000);
});

test('validate rejects a negative transitionMs', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 2, transitionMs: -5 }, KNOWN),
    /transitionMs must be a number >= 0/);
});

test('validate rejects a non-number transitionMs', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 2, transitionMs: 'x' }, KNOWN),
    /transitionMs must be a number >= 0/);
});

test('validate rejects an empty palettes array', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [], delay_s: 2 }, KNOWN),
    /palettes must be a non-empty array/);
});

test('validate rejects a NEGATIVE delay_s', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: -1 }, KNOWN),
    /delay_s must be a number >= 0/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 'x' }, KNOWN),
    /delay_s must be a number >= 0/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: NaN }, KNOWN),
    /delay_s must be a number >= 0/);
});

test('validate rejects a non-boolean active', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: 1, palettes: ['aurora'], delay_s: 2 }, KNOWN),
    /active must be a boolean/);
});

test('validate rejects a non-boolean shuffle', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 2, shuffle: 'x' }, KNOWN),
    /shuffle must be a boolean/);
});

test('validate rejects an unknown palette id when knownIds is provided', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['nope'], delay_s: 2 }, KNOWN),
    /"nope" is not a known palette id/);
});

test('validate without knownIds skips membership but still checks shape', () => {
  const out = ColorAutopilot.validate({ active: true, palettes: ['anything'], delay_s: 2 });
  assert.deepEqual(out.palettes, ['anything']);
});

// ── E1: inline {c1,c2} pairs alongside library ids (docs/53 §5.3) ───────────
// PALETTE TURNS posts five ad-hoc colour pairs that have no library id. They
// must validate, must NOT be membership-checked against knownIds, and must
// coexist with ids in one set.

test('validate accepts inline {c1,c2} pairs and does not membership-check them', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: [{ c1: 0.07, c2: 0 }, { c1: 0, c2: 0.62 }], delay_s: 4 }, KNOWN);
  assert.deepEqual(out.palettes, [{ c1: 0.07, c2: 0 }, { c1: 0, c2: 0.62 }]);
});

test('validate accepts a MIXED set of library ids and inline pairs', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: ['aurora', { c1: 0.5, c2: 1 }, 'deep_sea'], delay_s: 4 }, KNOWN);
  assert.deepEqual(out.palettes, ['aurora', { c1: 0.5, c2: 1 }, 'deep_sea']);
});

test('validate COPIES inline pairs (daemon state cannot mutate under the caller)', () => {
  const wire = { active: true, palettes: [{ c1: 0.1, c2: 0.2 }], delay_s: 4 };
  const out = ColorAutopilot.validate(wire, KNOWN);
  wire.palettes[0].c1 = 0.9;
  assert.equal(out.palettes[0].c1, 0.1);
});

test('validate rejects an inline pair with a hue outside [0,1]', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [{ c1: 1.4, c2: 0.2 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c1 must be a hue number in \[0,1\]/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [{ c1: 0.2, c2: -0.1 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c2 must be a hue number in \[0,1\]/);
});

test('validate rejects an inline pair with a missing / non-numeric hue', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [{ c1: 0.2 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c2 must be a hue number/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [{ c1: '0.2', c2: 0.3 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c1 must be a hue number/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [{ c1: NaN, c2: 0.3 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c1 must be a hue number/);
});

// ── D2 (docs/55 §1): FULL-HSV inline pair channels ─────────────────────────
// A channel is EITHER a hue number (the historical wire, byte-unchanged) OR a
// full {h,s,v} object. The Live Touch MASTER/HUE generators vary v, so a
// hue-only wire could not express them at all.

test('validate accepts {h,s,v} channels alongside plain hue numbers', () => {
  const out = ColorAutopilot.validate({
    active: true,
    palettes: [
      { c1: { h: 0.72, s: 0.95, v: 1 }, c2: { h: 0.72, s: 0.95, v: 0.78 } },
      { c1: 0.4, c2: { h: 0.1, s: 0.5, v: 0.25 } },
    ],
    delay_s: 4,
  }, KNOWN);
  assert.deepEqual(out.palettes, [
    { c1: { h: 0.72, s: 0.95, v: 1 }, c2: { h: 0.72, s: 0.95, v: 0.78 } },
    { c1: 0.4, c2: { h: 0.1, s: 0.5, v: 0.25 } },
  ]);
});

test('validate DEEP-COPIES {h,s,v} channels (no aliasing into daemon state)', () => {
  const wire = { active: true, palettes: [{ c1: { h: 0.2, s: 1, v: 1 }, c2: 0.5 }], delay_s: 4 };
  const out = ColorAutopilot.validate(wire, KNOWN);
  wire.palettes[0].c1.h = 0.9;
  assert.equal(out.palettes[0].c1.h, 0.2);
});

test('validate accepts and deep-copies one exact five-slot target per palette entry', () => {
  const palettes = [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }];
  const livePalettes = [
    [0.1, 0.6, 0.2, 0.3, 0.4].map(h => ({ h, s: 1, v: 1 })),
    [0.6, 0.1, 0.3, 0.4, 0.2].map(h => ({ h, s: 1, v: 1 })),
  ];
  const out = ColorAutopilot.validate({
    active: true, palettes, livePalettes, delay_s: 2, transitionMs: 400,
  }, KNOWN);
  livePalettes[0][2].h = 0.99;
  assert.equal(out.livePalettes[0][2].h, 0.2);
  assert.equal(out.livePalettes.length, out.palettes.length);
});

test('validate refuses ambiguous or mismatched five-slot sequences loudly', () => {
  const palettes = [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }];
  const goodState = [0.1, 0.6, 0.2, 0.3, 0.4].map(h => ({ h, s: 1, v: 1 }));
  assert.throws(() => ColorAutopilot.validate({
    active: true, palettes, livePalettes: [goodState], delay_s: 2,
  }), /same length as colorAutopilot\.palettes/);
  assert.throws(() => ColorAutopilot.validate({
    active: true, palettes: [palettes[0]], livePalettes: [goodState.slice(0, 4)], delay_s: 2,
  }), /must contain exactly 5 HSV slots/);
  assert.throws(() => ColorAutopilot.validate({
    active: true,
    palettes: [palettes[0]],
    livePalettes: [[0.9, 0.6, 0.2, 0.3, 0.4].map(h => ({ h, s: 1, v: 1 }))],
    delay_s: 2,
  }), /slots 0\/1 must exactly match/);
  assert.throws(() => ColorAutopilot.validate({
    active: true,
    palettes: [palettes[0]],
    livePalettes: [[0.1, 0.6, 0.2, 0.3, 0.4]],
    delay_s: 2,
  }), /must be an \{h,s,v\} object/);
});

test('validate rejects a bad CHANNEL of an {h,s,v} pair, naming index + channel', () => {
  assert.throws(
    () => ColorAutopilot.validate(
      { active: true, palettes: [{ c1: 0.1, c2: { h: 0.2, s: 1.5, v: 1 } }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c2\.s must be a number in \[0,1\]/);
  assert.throws(
    () => ColorAutopilot.validate(
      { active: true, palettes: [{ c1: 0.1, c2: 0.2 }, { c1: { h: 0.2, s: 1 }, c2: 0.3 }], delay_s: 4 }, KNOWN),
    /palettes\[1\]\.c1\.v must be a number in \[0,1\]/);
  assert.throws(
    () => ColorAutopilot.validate(
      { active: true, palettes: [{ c1: { h: NaN, s: 1, v: 1 }, c2: 0.3 }], delay_s: 4 }, KNOWN),
    /palettes\[0\]\.c1\.h must be a number in \[0,1\]/);
});

// ── delay_s 0 == CONTINUOUS (docs/55 §3.1) ─────────────────────────────────

test('validate accepts delay_s 0 when transitionMs >= 100 (continuous crossfade)', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }], delay_s: 0, transitionMs: 1500 },
    KNOWN);
  assert.equal(out.delay_s, 0);
  assert.equal(out.transitionMs, 1500);
});

test('validate REFUSES delay_s 0 with a too-short fade (zero+zero is a spin loop)', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 0 }, KNOWN),
    /delay_s 0 \(continuous\) requires transitionMs >= 100/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 0, transitionMs: 0 }, KNOWN),
    /delay_s 0 \(continuous\) requires transitionMs >= 100/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 0, transitionMs: 99 }, KNOWN),
    /delay_s 0 \(continuous\) requires transitionMs >= 100/);
});

test('validate still rejects junk entries that are neither an id nor a pair', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [42], delay_s: 4 }, KNOWN),
    /must be a non-empty string or a \{c1,c2\} pair/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [[0.1, 0.2]], delay_s: 4 }, KNOWN),
    /must be a non-empty string or a \{c1,c2\} pair/);
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: [null], delay_s: 4 }, KNOWN),
    /must be a non-empty string or a \{c1,c2\} pair/);
});

test('inline pairs cycle and persist exactly like ids', async () => {
  const cfg = tmpCfg();
  const applied = [];
  const pairs = [{ c1: 0.07, c2: 0 }, { c1: 0, c2: 0.62 }, { c1: 0.62, c2: 0.28 }];
  const ca = new ColorAutopilot((p) => { applied.push(p); }, cfg);
  ca.setState(ColorAutopilot.validate({ active: true, palettes: pairs, delay_s: 1 }));
  await ca.triggerNext();
  await ca.triggerNext();
  await ca.triggerNext();
  await ca.triggerNext();
  assert.deepEqual(applied, [pairs[0], pairs[1], pairs[2], pairs[0]]);
  // Round-trips through the runtime YAML file untouched.
  const reloaded = new ColorAutopilot(() => {}, cfg);
  assert.deepEqual(reloaded.state.palettes, pairs);
});

// ── timer behavior (sequential / pause / persistence) ───────────────────────

test('sequential cycling advances through the palette set with wrap', async () => {
  const applied = [];
  const ca = new ColorAutopilot((id) => { applied.push(id); }, tmpCfg());
  ca.setState({ active: true, palettes: ['aurora', 'bass_drop', 'deep_sea'], delay_s: 1, shuffle: false });
  // Manually advance (triggerNext) to make the picks deterministic without timers.
  await ca.triggerNext();
  await ca.triggerNext();
  await ca.triggerNext();
  await ca.triggerNext();
  assert.deepEqual(applied, ['aurora', 'bass_drop', 'deep_sea', 'aurora']);
});

test('inactive state applies nothing (paused)', async () => {
  const applied = [];
  const ca = new ColorAutopilot((id) => { applied.push(id); }, tmpCfg());
  ca.setState({ active: false, palettes: ['aurora'], delay_s: 1, shuffle: false });
  await ca.triggerNext();
  assert.equal(applied.length, 0);
});

test('config persists across instances on the same file', () => {
  const cfg = tmpCfg();
  const a = new ColorAutopilot(() => {}, cfg);
  a.setState({ active: true, palettes: ['aurora', 'bass_drop'], delay_s: 4, shuffle: true });
  const b = new ColorAutopilot(() => {}, cfg);
  assert.deepEqual(b.state, { active: true, mode: 'palettes', palettes: ['aurora', 'bass_drop'], delay_s: 4, shuffle: true, transitionMs: 0 });
});

test('a CONTINUOUS full-HSV ring persists through the runtime YAML verbatim', () => {
  // D2 + CONT together: the widened channel form and delay_s 0 must both
  // survive a yaml.dump/load round trip, because that file is what a restart
  // reads back.
  const cfg = tmpCfg();
  const palettes = [
    { c1: { h: 0.72, s: 0.95, v: 1 }, c2: { h: 0.72, s: 0.95, v: 0.25 } },
    { c1: { h: 0.72, s: 0.95, v: 0.25 }, c2: 0.72 },
  ];
  const a = new ColorAutopilot(() => {}, cfg);
  a.setState(ColorAutopilot.validate(
    { active: true, palettes, delay_s: 0, shuffle: false, transitionMs: 1500 }));
  a.stop();
  const b = new ColorAutopilot(() => {}, cfg);
  b.stop();
  assert.deepEqual(b.state, {
    active: true, mode: 'palettes', palettes, delay_s: 0, shuffle: false, transitionMs: 1500,
  });
});

test('a throwing applyPalette propagates (no silent skip)', async () => {
  const ca = new ColorAutopilot(() => { throw new Error('palette boom'); }, tmpCfg());
  ca.setState({ active: true, palettes: ['aurora'], delay_s: 1, shuffle: false });
  await assert.rejects(() => ca.triggerNext(), /palette boom/);
});

test('timer fires applyPalette on the delay and stops cleanly when deactivated', async () => {
  const applied = [];
  const ca = new ColorAutopilot((id) => { applied.push(id); }, tmpCfg());
  ca.setState({ active: true, palettes: ['aurora', 'bass_drop'], delay_s: 0.05, shuffle: false });
  await new Promise((r) => setTimeout(r, 170)); // ~3 ticks at 50ms
  const countAfter = applied.length;
  assert.ok(countAfter >= 2, `expected >=2 timer-driven applies, got ${countAfter}`);
  ca.setState({ active: false, palettes: ['aurora', 'bass_drop'], delay_s: 0.05, shuffle: false });
  await new Promise((r) => setTimeout(r, 170));
  assert.equal(applied.length, countAfter, 'no further applies after deactivation');
});

// ── crossfade tween (transitionMs > 0) ──────────────────────────────────────
// Inject a FAKE clock + a manual frame scheduler so the ramp advances
// deterministically (no real timers). The harness mirrors the engine wiring:
// resolvePaletteFn(id) → params, applyParamsFn(params) → write. A palette is a
// single-hue param object so the interpolation is easy to assert.

const HUE = { aurora: 0, bass_drop: 100, deep_sea: 240 };

// Build a ColorAutopilot with crossfade hooks driven by a controllable clock.
// Returns { ca, writes, advance } where `writes` collects every applied params
// object and `advance(ms)` moves the clock forward, firing every frame whose
// time has come (the scheduler stores frames; we fire them in order).
function makeCrossfadeCA(transitionMs) {
  const writes = [];
  let nowMs = 0;
  const queue = []; // pending { fn, at }
  const ca = new ColorAutopilot(
    (id) => { writes.push(resolve(id)); }, // hard-cut fallback (unused when crossfading)
    tmpCfg(),
    {
      resolvePaletteFn: resolve,
      applyParamsFn: (p) => writes.push(p),
      now: () => nowMs,
      scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
      clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
    },
  );
  function resolve(id) {
    if (!(id in HUE)) throw new Error(`unknown palette ${id}`);
    return { colorPalette1: { h: HUE[id], s: 1, v: 1 } };
  }
  function advance(ms) {
    const target = nowMs + ms;
    // Fire frames in chronological order until we pass `target`.
    let guard = 0;
    while (true) {
      const next = queue.filter((h) => h.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      const i = queue.indexOf(next);
      queue.splice(i, 1);
      nowMs = next.at;
      next.fn();
      if (++guard > 10000) throw new Error('runaway tween');
    }
    nowMs = target;
  }
  ca.setState({ active: true, palettes: ['aurora', 'bass_drop'], delay_s: 1, shuffle: false, transitionMs });
  return { ca, writes, advance };
}

test('transitionMs=0 hard-cuts: the switch writes the exact target params, no ramp', async () => {
  const { ca, writes } = makeCrossfadeCA(0);
  await ca.triggerNext(); // aurora — first apply, snaps
  await ca.triggerNext(); // bass_drop — hard cut
  // Only the two endpoint writes; no intermediate hues between 0 and 100.
  const hues = writes.map((w) => w.colorPalette1.h);
  assert.deepEqual(hues, [0, 100]);
});

test('crossfade ramps the palette params over transitionMs toward the target', async () => {
  const { ca, writes, advance } = makeCrossfadeCA(1000);
  await ca.triggerNext(); // aurora (h=0) — first apply snaps (nothing to fade FROM)
  assert.equal(writes.at(-1).colorPalette1.h, 0, 'first palette snaps to 0');

  // Switch to bass_drop (h=100). The first frame fires immediately at t=0 → h≈0.
  const p = ca.triggerNext();
  const firstHue = writes.at(-1).colorPalette1.h;
  assert.ok(firstHue < 50, `first crossfade frame near the START hue, got ${firstHue}`);

  // Advance halfway: hue should be roughly midway (monotonic, between 0 and 100).
  advance(500);
  const midHue = writes.at(-1).colorPalette1.h;
  assert.ok(midHue > firstHue && midHue < 100, `midpoint hue ramps between start and target, got ${midHue}`);

  // Advance to the end: lands EXACTLY on the target hue.
  advance(600);
  await p;
  assert.equal(writes.at(-1).colorPalette1.h, 100, 'tween lands exactly on target hue');

  // The intermediate writes must be monotonically non-decreasing toward 100.
  const hues = writes.map((w) => w.colorPalette1.h);
  for (let i = 2; i < hues.length; i++) {
    assert.ok(hues[i] >= hues[i - 1] - 1e-9, `hue non-decreasing across the ramp at ${i}: ${hues[i - 1]} → ${hues[i]}`);
  }
});

test('seedCurrentParams makes the FIRST apply crossfade FROM the seeded live color (no snap)', async () => {
  // Timeline cue-start path: seed the current on-screen color, then the first
  // palette (aurora, h=0) ramps FROM the seeded hue instead of snapping.
  const { ca, writes, advance } = makeCrossfadeCA(1000);
  ca.seedCurrentParams({ colorPalette1: { h: 60, s: 1, v: 1 } });
  const p = ca.triggerNext(); // aurora (h=0), fading DOWN from the seeded h=60
  const firstHue = writes.at(-1).colorPalette1.h;
  assert.ok(firstHue > 50, `first frame starts near the SEEDED hue (60), got ${firstHue}`);
  advance(1100);
  await p;
  assert.equal(writes.at(-1).colorPalette1.h, 0, 'tween lands exactly on the target hue');
});

test('palette ticks delegate the exact parallel five-slot state to both apply paths', async () => {
  const pair = { c1: 0.1, c2: 0.6 };
  const liveState = [0.1, 0.6, 0.1, 0.6, 0.1].map(h => ({ h, s: 1, v: 1 }));
  const hardCalls = [];
  const resolveCalls = [];
  const hard = new ColorAutopilot((entry, livePalette) => hardCalls.push({ entry, livePalette }), tmpCfg(), {
    resolvePaletteFn: (entry, livePalette) => {
      resolveCalls.push({ entry, livePalette });
      return { colorPalette1: livePalette[0], colorPalette2: livePalette[1] };
    },
  });
  hard.setState(ColorAutopilot.validate({
    active: true, palettes: [pair], livePalettes: [liveState], delay_s: 1,
  }));
  await hard.triggerNext();
  assert.deepEqual(hardCalls, [{ entry: pair, livePalette: liveState }]);
  assert.deepEqual(resolveCalls, [{ entry: pair, livePalette: liveState }]);
});

// ── ADDITIVE scheduling (operator ruling 2026-07-03) ────────────────────────
// The crossfade must NOT eat into the hold. With delay_s = 1 and transitionMs
// = 1000 the cycle is 2 s (1 s hold + 1 s fade): the next switch is scheduled
// AFTER the fade completes, at fadeEnd + delay_s — never at fadeStart +
// delay_s. This is the pattern Autopilot's await-swap-then-reschedule model
// (autopilot.js _runTick awaits changePattern before _scheduleNext).

test('additive scheduling: next switch = fade END + delay_s, not fade START + delay_s', async () => {
  const { ca, advance } = makeCrossfadeCA(1000);
  await ca.triggerNext(); // aurora — first apply SNAPS at t=0 (nothing to fade from)
  // The snap completes instantly, so the reschedule lands at t=0 + delay_s.
  assert.equal(ca.nextSwapAtMs, 1000, 'snap apply reschedules at +delay_s');

  const p = ca.triggerNext(); // fade to bass_drop starts at t=0 on the fake clock
  advance(1000);              // drive the tween to completion (fade ends at t=1000)
  await p;
  // Reschedule happens AFTER the awaited fade: t=1000 (fade end) + 1000 (hold)
  // = 2000. The overlapped (delay-only) bug would leave this at 1000.
  assert.equal(ca.nextSwapAtMs, 2000, 'next switch fires delay_s AFTER the fade completes');
});

test('real-timer cycle period is delay_s + transitionMs (fade does not eat the hold)', async () => {
  const HOLD_MS = 80;
  const FADE_MS = 120;
  // resolvePaletteFn fires exactly once per switch, at switch START — stamp it.
  const switchStarts = [];
  const resolve = (id) => {
    switchStarts.push(Date.now());
    return { colorPalette1: { h: HUE[id], s: 1, v: 1 } };
  };
  const ca = new ColorAutopilot((id) => { resolve(id); }, tmpCfg(), {
    resolvePaletteFn: resolve,
    applyParamsFn: () => {},
  });
  ca.setState({ active: true, palettes: ['aurora', 'bass_drop'], delay_s: HOLD_MS / 1000, shuffle: false, transitionMs: FADE_MS });
  // Expected starts: ~80 ms (snap), ~160 ms (fades until ~280 ms), ~360 ms.
  await new Promise((r) => setTimeout(r, 600));
  ca.deactivate();
  assert.ok(switchStarts.length >= 3, `expected >=3 switches in 600ms, got ${switchStarts.length}`);
  // Gap between two switches where the FIRST one faded: >= hold + fade. Real
  // timers only ever run LATE, so additive scheduling can never produce a gap
  // under ~200 ms here — the overlapped bug would produce ~80 ms. (-5 ms
  // tolerance for Date.now()-vs-timer rounding.)
  const gap = switchStarts[2] - switchStarts[1];
  assert.ok(gap >= HOLD_MS + FADE_MS - 5, `switch gap must be >= hold+fade (~200ms), got ${gap}ms`);
});

test('a throwing timer-driven tick logs loud but re-arms the cycle (mirrors pattern Autopilot)', async () => {
  // First tick throws, later ticks succeed — the daemon must survive the
  // failure and keep cycling, exactly like Autopilot._runTick's catch +
  // reschedule. (triggerNext, the DIRECT call path, still rejects — see the
  // 'throwing applyPalette propagates' test above.)
  const applied = [];
  let boom = true;
  const ca = new ColorAutopilot((id) => {
    if (boom) { boom = false; throw new Error('palette boom'); }
    applied.push(id);
  }, tmpCfg());
  ca.setState({ active: true, palettes: ['aurora', 'bass_drop'], delay_s: 0.05, shuffle: false });
  await new Promise((r) => setTimeout(r, 250)); // ~4-5 ticks at 50ms; #1 throws
  ca.deactivate();
  assert.ok(applied.length >= 1, `cycle must keep running after a throwing tick, got ${applied.length} applies`);
});

// ── D1: shortest-arc hue interpolation (docs/55 §1) ────────────────────────
// THE REFERENCE TABLE. The identical table is pinned in CaptainPad's
// components/deck/colors_window_logic.test.ts — the engine tween and the
// client's scrubber/preview maths must agree to the bit, so a change to either
// implementation breaks a test on BOTH sides.

const LERP_HUE_TABLE = [
  // [a,    b,    t,   expected]
  [0.9, 0.1, 0.5, 0.0],   // wraps FORWARD through 1.0 (short way, 0.2 apart)
  [0.1, 0.9, 0.5, 0.0],   // wraps BACKWARD through 0.0
  [0.2, 0.6, 0.5, 0.4],   // no wrap — plain midpoint
  [0.0, 0.5, 0.5, 0.25],  // exact-half tie resolves FORWARD
  [0.33, 0.33, 0.5, 0.33],// a == b is a fixed point
  [0.9, 0.1, 0.0, 0.9],   // exact endpoints
  [0.9, 0.1, 1.0, 0.1],
  [0.2, 0.6, 0.0, 0.2],
  [0.2, 0.6, 1.0, 0.6],
];

test('lerpHue matches the pinned shortest-arc reference table', () => {
  for (const [a, b, t, expected] of LERP_HUE_TABLE) {
    const got = lerpHue(a, b, t);
    assert.ok(Math.abs(got - expected) < 1e-9,
      `lerpHue(${a}, ${b}, ${t}) expected ${expected}, got ${got}`);
  }
});

test('lerpHue never leaves the unit wheel and never takes the long way round', () => {
  for (let i = 0; i < 100; i++) {
    const a = i / 100;
    for (let j = 0; j < 100; j += 7) {
      const b = j / 100;
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const h = lerpHue(a, b, t);
        assert.ok(h >= 0 && h < 1, `lerpHue(${a},${b},${t}) = ${h} left [0,1)`);
        // The distance travelled from `a` is at most t × the SHORT arc — never
        // the long way (which would exceed 0.5 at t = 1).
        const raw = Math.abs(h - a);
        const walked = Math.min(raw, 1 - raw);
        assert.ok(walked <= 0.5 * t + 1e-9,
          `lerpHue(${a},${b},${t}) walked ${walked} — that is the LONG arc`);
      }
    }
  }
});

test('lerpParams takes the SHORT arc for colour leaves and stays linear elsewhere', () => {
  // A colour leaf: h wraps the short way, s and v lerp linearly.
  const out = lerpParams(
    { colorPalette1: { h: 0.9, s: 1, v: 1 } },
    { colorPalette1: { h: 0.1, s: 0.5, v: 0.2 } },
    0.5);
  assert.ok(Math.abs(out.colorPalette1.h - 0.0) < 1e-9, `h short arc, got ${out.colorPalette1.h}`);
  assert.equal(out.colorPalette1.s, 0.75);
  assert.ok(Math.abs(out.colorPalette1.v - 0.6) < 1e-9);
});

test('lerpParams leaves NON-colour objects byte-identical to the linear behavior', () => {
  // Not colour-shaped (no s/v) → every leaf stays plain linear, `h` included.
  const plain = lerpParams({ a: { h: 0.9, x: 0 } }, { a: { h: 0.1, x: 10 } }, 0.5);
  assert.equal(plain.a.h, 0.5, 'a non-colour object keeps LINEAR h');
  assert.equal(plain.a.x, 5);
  // Colour-SHAPED but off the unit wheel (the crossfade suite's 0/100/240
  // fixtures) → also linear, because modular arithmetic is meaningless there.
  const offWheel = lerpParams(
    { colorPalette1: { h: 0, s: 1, v: 1 } },
    { colorPalette1: { h: 100, s: 1, v: 1 } },
    0.5);
  assert.equal(offWheel.colorPalette1.h, 50, 'off-wheel h stays linear, not modular');
  // Scalars and mismatched leaves are untouched.
  assert.deepEqual(lerpParams({ n: 0, s: 'a' }, { n: 10, s: 'b' }, 0.25), { n: 2.5, s: 'b' });
});

// ── delay_s 0 == CONTINUOUS: the scheduler honors it (docs/55 §3.1 item 2) ──
// The old `Number(st.delay_s) > 0 ? … : DEFAULT_DELAY_S` turned CONT into a
// silent 30 s hold. These pin that it cannot come back.

test('delay_s 0 schedules the next tick IMMEDIATELY (no 30 s fallback hold)', async () => {
  const writes = [];
  let nowMs = 0;
  const queue = [];
  const resolve = (id) => ({ colorPalette1: { h: id === 'a' ? 0.1 : 0.6, s: 1, v: 1 } });
  const ca = new ColorAutopilot((id) => { writes.push(resolve(id)); }, tmpCfg(), {
    resolvePaletteFn: resolve,
    applyParamsFn: (p) => writes.push(p),
    now: () => nowMs,
    scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
    clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
  });
  const advance = (ms) => {
    const target = nowMs + ms;
    let guard = 0;
    for (;;) {
      const next = queue.filter((h) => h.at <= target).sort((x, y) => x.at - y.at)[0];
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      nowMs = next.at;
      next.fn();
      if (++guard > 10000) throw new Error('runaway tween');
    }
    nowMs = target;
  };

  ca.setState(ColorAutopilot.validate(
    { active: true, palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }], delay_s: 0, transitionMs: 1000 }));
  // The fallback bug would put this at 30000.
  assert.equal(ca.nextSwapAtMs, 0, 'CONT arms the first tick with ZERO hold');

  ca.seedCurrentParams({ colorPalette1: { h: 0.1, s: 1, v: 1 }, colorPalette2: { h: 0.6, s: 1, v: 1 } });
  const p = ca.triggerNext();
  advance(1000);   // drive the fade to completion
  await p;
  // Reschedule = fade END (t=1000) + ZERO hold. The bug would give 31000.
  assert.equal(ca.nextSwapAtMs, 1000, 'CONT re-arms the instant the fade lands');
  ca.deactivate();
});

test('delay_s 0 runs back-to-back fades on REAL timers (no hidden hold)', async () => {
  const FADE_MS = 100;
  const switchStarts = [];
  const resolve = (id) => {
    switchStarts.push(Date.now());
    return { colorPalette1: { h: HUE[id] / 360, s: 1, v: 1 } };
  };
  const ca = new ColorAutopilot((id) => { resolve(id); }, tmpCfg(), {
    resolvePaletteFn: resolve,
    applyParamsFn: () => {},
  });
  ca.setState(ColorAutopilot.validate(
    { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 0, transitionMs: FADE_MS }));
  await new Promise((r) => setTimeout(r, 600));
  ca.deactivate();
  // With a 30 s fallback hold this would be 1 (the first tick only). With a
  // true zero hold the cycle is just the fade: ~5-6 switches in 600 ms.
  assert.ok(switchStarts.length >= 3,
    `CONT must cycle every ~${FADE_MS}ms; got ${switchStarts.length} switches in 600ms`);
  // …and it must not become a SPIN loop either: the fade still occupies the
  // cycle, so consecutive switches are at least a fade apart.
  const gap = switchStarts[2] - switchStarts[1];
  assert.ok(gap >= FADE_MS - 15, `CONT cycle must be >= the fade (${FADE_MS}ms), got ${gap}ms`);
});

test('a legacy config with NO delay_s at all still falls back to the 30 s default', () => {
  // The fallback survives for its one legitimate case — an absent/unparseable
  // value — which is what makes honoring an explicit 0 safe.
  const ca = new ColorAutopilot(() => {}, tmpCfg());
  ca.config.colorAutopilot = { active: true, palettes: ['aurora'], shuffle: false };
  ca.start();
  assert.ok(ca.nextSwapAtMs - Date.now() > 25000, 'absent delay_s still arms the 30 s default');
  ca.deactivate();
});

test('reconfig mid-crossfade cancels the in-flight tween cleanly (no further frames)', async () => {
  const { ca, writes, advance } = makeCrossfadeCA(1000);
  await ca.triggerNext(); // aurora snaps
  const p = ca.triggerNext(); // start fade to bass_drop
  advance(300); // partway
  const countBeforeReconfig = writes.length;
  // Reconfigure — this bumps generation and cancels the tween.
  ca.setState({ active: true, palettes: ['deep_sea'], delay_s: 1, shuffle: false, transitionMs: 1000 });
  await p; // the cancelled tween's promise resolves
  advance(2000); // let any stale frames that WOULD have fired pass
  // No additional writes from the abandoned tween after the reconfig point.
  assert.equal(writes.length, countBeforeReconfig, 'no stale tween frames after reconfig');
});

// ── The SLIDING ADJACENT-PAIR WINDOW (_224 order 2) ─────────────────────────
// The operator's rotation semantics: a two-slot window sliding over the five
// chosen colours, one step per turn, wrapping —
//   [c1],[c2],c3,c4,c5 -> c1,[c2],[c3],c4,c5 -> ... -> [c5],c2,c3,c4,[c1]
// A five-entry CHAINED ring is that window, and the daemon's sequential cursor
// is what slides it. These pin the daemon end of the contract; the Deck's
// `rotationCursor` inverts the same maths to draw the highlight, and the
// segment property below is exactly what makes that inversion possible.

/** The five-colour ring the COLORS window posts, as chained adjacent pairs. */
const WINDOW_RING = [0.07, 0.0, 0.62, 0.28, 0.74];
const WINDOW_PAIRS = WINDOW_RING.map((h, i) => ({ c1: h, c2: WINDOW_RING[(i + 1) % WINDOW_RING.length] }));

/** A five-pair chained ring on a fake clock, with every applied frame recorded. */
function makeWindowCA(transitionMs, delayS) {
  const frames = [];
  let nowMs = 0;
  const queue = [];
  const resolve = (entry) => ({
    colorPalette1: { h: entry.c1, s: 1, v: 1 },
    colorPalette2: { h: entry.c2, s: 1, v: 1 },
  });
  const ca = new ColorAutopilot((entry) => { frames.push(resolve(entry)); }, tmpCfg(), {
    resolvePaletteFn: resolve,
    applyParamsFn: (p) => frames.push(p),
    now: () => nowMs,
    scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
    clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
  });
  const advance = (ms) => {
    const target = nowMs + ms;
    let guard = 0;
    for (;;) {
      const next = queue.filter((h) => h.at <= target).sort((x, y) => x.at - y.at)[0];
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      nowMs = next.at;
      next.fn();
      if (++guard > 10000) throw new Error('runaway tween');
    }
    nowMs = target;
  };
  ca.setState(ColorAutopilot.validate(
    { active: true, palettes: WINDOW_PAIRS, delay_s: delayS, shuffle: false, transitionMs }));
  return { ca, frames, advance };
}

test('a five-pair ring slides its window ONE step per turn, and wraps', async () => {
  const { ca, frames, advance } = makeWindowCA(200, 0);
  // Ten turns = two full laps, so the T5 -> T1 wrap is exercised twice.
  for (let turn = 0; turn < 10; turn++) {
    const p = ca.triggerNext();
    advance(200);
    await p;
    const landed = frames[frames.length - 1];
    const expected = WINDOW_PAIRS[turn % WINDOW_PAIRS.length];
    assert.equal(landed.colorPalette1.h, expected.c1,
      `turn ${turn + 1} must land on window ${turn % 5} (slots ${turn % 5}+${(turn % 5) + 1})`);
    assert.equal(landed.colorPalette2.h, expected.c2, `turn ${turn + 1} second slot`);
  }
  ca.deactivate();
});

test('every colour is on the rig exactly twice a lap — as both ends of a window', async () => {
  const { ca, frames, advance } = makeWindowCA(200, 0);
  const seen = [];
  for (let turn = 0; turn < WINDOW_PAIRS.length; turn++) {
    const p = ca.triggerNext();
    advance(200);
    await p;
    const landed = frames[frames.length - 1];
    seen.push(landed.colorPalette1.h, landed.colorPalette2.h);
  }
  for (const h of WINDOW_RING) {
    assert.equal(seen.filter((x) => x === h).length, 2,
      `hue ${h} must appear twice a lap — once leading a window, once trailing`);
  }
  ca.deactivate();
});

test('CONT slides a FIVE-colour window continuously, at the operator\'s fade', async () => {
  // Operator order (_224): "if the crossfader is in CONT, TURNS in CONT rotates
  // continuously too". The daemon must arm each turn with ZERO hold for a
  // five-entry ring exactly as it does for the two-entry crossfade.
  const FADE = 250;
  const { ca, advance } = makeWindowCA(FADE, 0);
  assert.equal(ca.nextSwapAtMs, 0, 'CONT arms the first turn of a 5-ring with zero hold');
  ca.seedCurrentParams({
    colorPalette1: { h: WINDOW_RING[0], s: 1, v: 1 },
    colorPalette2: { h: WINDOW_RING[1], s: 1, v: 1 },
  });
  const p = ca.triggerNext();
  advance(FADE);
  await p;
  // Fade end + ZERO hold: one lap is exactly five fades, nothing else.
  assert.equal(ca.nextSwapAtMs, FADE, 'CONT re-arms a 5-ring the instant the fade lands');
  ca.deactivate();
});

test('the HOLD and the FADE are independent, so one transport drives both rings', async () => {
  // _224 order 1: TURNS posts the crossfade card's own delay_s + transitionMs.
  // The daemon must treat a 5-entry ring's timing exactly as it treats a
  // 2-entry one — additive hold-then-fade, no derived value anywhere.
  const { ca, advance } = makeWindowCA(400, 2);
  assert.equal(ca.nextSwapAtMs, 2000, 'the hold is the operator\'s delay_s, verbatim');
  ca.seedCurrentParams({
    colorPalette1: { h: WINDOW_RING[0], s: 1, v: 1 },
    colorPalette2: { h: WINDOW_RING[1], s: 1, v: 1 },
  });
  advance(2000);                   // the hold elapses; the turn fires
  const armedAt = ca.nextSwapAtMs; // 2000 — when this turn was due
  const p = ca.triggerNext();
  advance(400);                    // the fade runs
  await p;
  // hold (2000) + fade (400) = a 2400 ms cycle: the fade is ADDITIVE to the
  // hold for a five-entry ring exactly as it is for the two-entry crossfade,
  // and nothing here is derived from the other.
  assert.equal(ca.nextSwapAtMs - armedAt, 2400, 'hold and fade are additive for a 5-ring too');
  ca.deactivate();
});

test('every mid-fade frame lies ON the from->to segment (what the Deck inverts)', async () => {
  // The Deck's `rotationCursor` recovers WHICH window and HOW FAR from the
  // broadcast palette by projecting it onto this segment. That only works
  // because the tween is exactly lerpHue on h and linear on s/v — so pin it.
  const FADE = 400;
  const { ca, frames, advance } = makeWindowCA(FADE, 0);
  ca.seedCurrentParams({
    colorPalette1: { h: WINDOW_RING[0], s: 1, v: 1 },
    colorPalette2: { h: WINDOW_RING[1], s: 1, v: 1 },
  });
  const p0 = ca.triggerNext();     // settle on window 0 (it is already there)
  advance(FADE);
  await p0;
  frames.length = 0;
  const from = WINDOW_PAIRS[0];
  const to = WINDOW_PAIRS[1];
  const p = ca.triggerNext();      // fade toward window 1
  advance(FADE);
  await p;
  assert.ok(frames.length >= 3, `expected several tween frames, got ${frames.length}`);
  for (const f of frames) {
    // Recover t from each channel independently; the two must AGREE, which is
    // precisely the residual check the Deck performs.
    const solve = (a, b, live) => {
      let d = b - a; d -= Math.floor(d); if (d > 0.5) d -= 1;
      let e = live - a; e -= Math.floor(e); if (e > 0.5) e -= 1;
      return Math.abs(d) < 1e-12 ? null : e / d;
    };
    const t1 = solve(from.c1, to.c1, f.colorPalette1.h);
    const t2 = solve(from.c2, to.c2, f.colorPalette2.h);
    assert.ok(t1 !== null && t1 >= -1e-9 && t1 <= 1 + 1e-9, `frame off segment: t1=${t1}`);
    if (t2 !== null) {
      assert.ok(Math.abs(t1 - t2) < 1e-9,
        `both slots must report the SAME progress: ${t1} vs ${t2}`);
    }
    assert.equal(f.colorPalette1.s, 1);
    assert.equal(f.colorPalette1.v, 1);
  }
  ca.deactivate();
});

test('a CONT five-colour ring is a legal wire the front door accepts', () => {
  // The whole of _224 order 1 rests on this being representable: a five-entry
  // ring with delay_s 0. It was reachable only from the crossfade card before.
  const out = ColorAutopilot.validate(
    { active: true, palettes: WINDOW_PAIRS, delay_s: 0, transitionMs: 800 });
  assert.equal(out.delay_s, 0);
  assert.equal(out.transitionMs, 800);
  assert.equal(out.palettes.length, 5);
  // …and the zero+zero spin loop is still unrepresentable for a 5-ring.
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: WINDOW_PAIRS, delay_s: 0, transitionMs: 50 }),
    /delay_s 0 \(continuous\) requires transitionMs >= 100/);
});
