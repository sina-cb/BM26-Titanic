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

test('validate accepts a good wire shape and normalizes shuffle default', () => {
  const out = ColorAutopilot.validate(
    { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2 }, KNOWN);
  assert.deepEqual(out, { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: false });
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
  assert.deepEqual(b.state, { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 4, shuffle: true });
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
