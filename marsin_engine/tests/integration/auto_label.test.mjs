/**
 * auto_label.test.mjs — deterministic unit guard for the reference labeler.
 * Builds synthetic Int16 clips with KNOWN structure and asserts the labeler
 * agrees (region coverage, drop on a real breakdown→full lift, zero drops on
 * steady/silent input). No audio files, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { labelTrack, labelFromStems } from './auto_label.mjs';

const SR = 44100;

/** Concatenate segments [{durSec, amp}] of a 60 Hz sub tone at given amplitude. */
function buildClip(segments) {
  let total = 0;
  for (const s of segments) total += Math.floor(SR * s.durSec);
  const out = new Int16Array(total);
  let cur = 0;
  for (const s of segments) {
    const n = Math.floor(SR * s.durSec);
    for (let i = 0; i < n; i++) {
      const t = (cur + i) / SR;
      out[cur + i] = Math.round(Math.sin(2 * Math.PI * 60 * t) * s.amp * 32767);
    }
    cur += n;
  }
  return { samples: out, sampleRate: SR };
}

test('a breakdown→full lift produces a drop near the boundary', () => {
  // 5 s quiet breakdown (amp 0.05) → 6 s full (amp 0.8). Drop ≈ 5 s.
  const clip = buildClip([{ durSec: 5, amp: 0.05 }, { durSec: 6, amp: 0.8 }]);
  const { drops, regions } = labelTrack(clip, { drops: { jumpRatio: 1.6, winMs: 1500 } });
  assert.ok(drops.length >= 1, `expected ≥1 drop, got ${drops.length}`);
  const near = drops.some((d) => Math.abs(d.ts - 5000) < 1500);
  assert.ok(near, `drop not near 5 s: ${drops.map((d) => (d.ts / 1000).toFixed(1)).join(',')}`);
  assert.ok(regions.length >= 1);
});

test('a drop in the FINAL window is still found (smooth() must not zero the tail)', () => {
  // Regression for the smooth() zero-tail bug: a breakdown→full lift whose
  // full section is the last few seconds must still register as SUSTAIN +
  // a drop, not be forced to THIN by an unfilled envelope tail.
  const clip = buildClip([{ durSec: 6, amp: 0.05 }, { durSec: 5, amp: 0.8 }]);
  const { drops } = labelTrack(clip, { drops: { jumpRatio: 1.6, winMs: 1500 } });
  assert.ok(drops.length >= 1, `tail drop missed (smooth zero-tail?): got ${drops.length}`);
  assert.ok(drops.some((d) => Math.abs(d.ts - 6000) < 1500), `tail drop not near 6 s: ${JSON.stringify(drops)}`);
});

test('steady-loud input yields ZERO drops (no breakdown to lift from)', () => {
  const clip = buildClip([{ durSec: 12, amp: 0.7 }]);
  const { drops } = labelTrack(clip);
  assert.equal(drops.length, 0, `steady loud must not drop: ${JSON.stringify(drops)}`);
});

test('silence yields zero drops', () => {
  const clip = { samples: new Int16Array(SR * 6), sampleRate: SR };
  const { drops } = labelTrack(clip);
  assert.equal(drops.length, 0);
});

test('fail-loud on empty clip (codex P0)', () => {
  assert.throws(() => labelTrack({ samples: new Int16Array(0), sampleRate: SR }), /empty/);
  assert.throws(() => labelTrack(null), /empty/);
});

test('labelFromStems requires bass+drums stems', () => {
  const mix = buildClip([{ durSec: 4, amp: 0.5 }]);
  assert.throws(() => labelFromStems({ mixture: mix }), /missing\/empty stem/);
});

test('labelFromStems: drop only when bass+drums engage with the lift', () => {
  // mixture: breakdown(2s,0.1) → full(6s,0.8). bass+drums: silent during
  // breakdown, full during the loud section → confirms the drop.
  const mixture = buildClip([{ durSec: 2, amp: 0.1 }, { durSec: 6, amp: 0.8 }]);
  const bass = buildClip([{ durSec: 2, amp: 0.0 }, { durSec: 6, amp: 0.8 }]);
  const drums = buildClip([{ durSec: 2, amp: 0.0 }, { durSec: 6, amp: 0.7 }]);
  const vocals = buildClip([{ durSec: 8, amp: 0.0 }]);
  const { drops, stemsPlan } = labelFromStems({ mixture, bass, drums, vocals }, { drops: { jumpRatio: 1.6, winMs: 1500 } });
  assert.ok(drops.length >= 1, `expected a stem-confirmed drop, got ${drops.length}`);
  assert.ok(Array.isArray(stemsPlan) && stemsPlan.length >= 1);
});
