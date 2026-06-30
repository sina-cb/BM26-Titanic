import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ColorAutopilot } from '../lib/color_autopilot.js';

const KNOWN = new Set(['aurora', 'bass_drop', 'deep_sea']);

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colorap-'));
  return path.join(dir, 'config.yaml');
}

// ── static validate (pure, no IO) ───────────────────────────────────────────

test('validate accepts a good wire shape and normalizes shuffle + transitionMs defaults', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2 }, KNOWN);
  assert.deepEqual(out, { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: false, transitionMs: 0 });
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

test('validate rejects delay_s <= 0', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, palettes: ['aurora'], delay_s: 0 }, KNOWN),
    /delay_s must be a number > 0/);
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
  assert.deepEqual(b.state, { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 4, shuffle: true, transitionMs: 0 });
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
