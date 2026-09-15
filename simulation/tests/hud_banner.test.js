/**
 * hud_banner.test.js — pure tests for the shared HUD-banner dismissal latch
 * (src/gui/hud_banner.js), operator ruling 2026-09-14: every persistent warning
 * banner must be hideable, and a dismissal must survive the status re-pushes and
 * polls that used to resurrect the patch-manager bars within 10 s.
 *
 * DOM-free: the reducer and the latch only. The element factory and the ✕ are
 * proved live (report `20260914_372`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_OCCURRENCE_KEY, HUD_BANNER_CLOSE_CLASS,
  occurrenceKey, reduceDismissal, DismissalLatch,
} from '../src/gui/hud_banner.js';

test('a banner with no dismissal shows whenever its condition holds', () => {
  assert.deepEqual(reduceDismissal({ show: true }, null), { visible: true, dismissedKey: null });
  assert.deepEqual(reduceDismissal({ show: true, key: 'x' }, null), { visible: true, dismissedKey: null });
});

test('a cleared / unknown condition hides and re-arms the latch', () => {
  for (const cleared of [{ show: false }, { show: false, text: '' }, null, undefined, {}]) {
    assert.deepEqual(reduceDismissal(cleared, 'default'), { visible: false, dismissedKey: null }, String(cleared));
  }
});

test('dismissing the current occurrence keeps it hidden across re-pushes of the same condition', () => {
  const key = occurrenceKey({ show: true });
  assert.equal(key, DEFAULT_OCCURRENCE_KEY);
  // ten census / status / poll re-pushes: still hidden, latch intact
  let latch = key;
  for (let i = 0; i < 10; i++) {
    const r = reduceDismissal({ show: true, text: `push ${i}` }, latch);
    assert.equal(r.visible, false, `re-push ${i} must not resurrect the banner`);
    latch = r.dismissedKey;
  }
  assert.equal(latch, key);
});

test('a NEW occurrence (different key) re-shows and drops the old dismissal', () => {
  const r = reduceDismissal({ show: true, key: 'ANGLE (NVIDIA …)' }, 'ANGLE (Intel …)');
  assert.deepEqual(r, { visible: true, dismissedKey: null });
});

test('occurrence keys: absent → default, numbers stringified, null/undefined → default', () => {
  assert.equal(occurrenceKey({ show: true }), DEFAULT_OCCURRENCE_KEY);
  assert.equal(occurrenceKey({ show: true, key: 7 }), '7');
  assert.equal(occurrenceKey({ show: true, key: 'blackout' }), 'blackout');
  assert.equal(occurrenceKey({ show: true, key: null }), DEFAULT_OCCURRENCE_KEY);
  assert.equal(occurrenceKey(null), DEFAULT_OCCURRENCE_KEY);
});

test('latch: dismiss → hidden through re-pushes → condition clears → next occurrence shows again', () => {
  const latch = new DismissalLatch();
  assert.equal(latch.apply({ show: true }), true);
  assert.equal(latch.dismissed, false);
  assert.equal(latch.dismiss(), false); // applied: hidden now
  assert.equal(latch.dismissed, true);
  assert.equal(latch.visible, false);
  assert.equal(latch.apply({ show: true, text: 'updated wording' }), false);
  assert.equal(latch.apply({ show: false }), false); // cleared → re-armed
  assert.equal(latch.dismissed, false);
  assert.equal(latch.apply({ show: true }), true); // back again → shown again
});

test('latch: dismissing while nothing is shown is a no-op (does not pre-hide the next occurrence)', () => {
  const latch = new DismissalLatch();
  assert.equal(latch.apply({ show: false }), false);
  latch.dismiss();
  assert.equal(latch.dismissed, false);
  assert.equal(latch.apply({ show: true }), true);
});

test('latch: a keyed occurrence — the blackout card switching to the stale-model wording re-shows', () => {
  const latch = new DismissalLatch();
  assert.equal(latch.apply({ show: true, key: 'blackout' }), true);
  latch.dismiss();
  assert.equal(latch.apply({ show: true, key: 'blackout' }), false);
  assert.equal(latch.apply({ show: true, key: 'stale' }), true);
  // and dismissing the stale wording does not hide a later blackout
  latch.dismiss();
  assert.equal(latch.apply({ show: true, key: 'blackout' }), true);
});

test('the ✕ class name is the one style.css styles', () => {
  assert.equal(HUD_BANNER_CLOSE_CLASS, 'hud-banner-close');
});
