import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ColorAutopilot, colorAutopilotMode, validateFollowNote } from '../../lib/color_autopilot.js';
import { generateScheme } from '../../lib/color_schemes.js';

/**
 * FOLLOW NOTE + LIVE RETUNE (docs/59 §§4-5, contract items W2/W3/W5).
 *
 * Everything here runs on a FAKE clock and a FAKE CPC. That is not just for
 * speed: the two behaviours under test are entirely about WHEN things happen —
 * that an unchanged note costs no writes, that hold and fade stay additive,
 * that a retune never produces a frame outside a tween — and a real clock can
 * only ever show that they *probably* happened.
 */

const SEVEN = ['complement', 'contrast', 'analogous', 'triadic', 'split', 'tetrad', 'golden'];

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colorfn-'));
  return path.join(dir, 'config.yaml');
}

function followWire(over = {}) {
  return {
    active: true,
    mode: 'followNote',
    followNote: {
      schemes: [...SEVEN],
      methodHoldS: 60,
      methodFadeS: 3,
      noteFadeMs: 400,
      sel: [0, 1],
      shuffle: false,
      ...over,
    },
  };
}

/**
 * A daemon wired to a fake CPC and a fake frame scheduler.
 *   writes   — every params object handed to applyParamsFn, in order
 *   setNote  — publish a note pair and fire the subscription (what the
 *              companion's 10 Hz DerivedSignals does on the real rig)
 *   publish  — fire the subscription WITHOUT changing the note (the hop-rate
 *              case: this must be write-free)
 *   advance  — move the fake clock, firing due tween frames in order
 */
// NOTE on fade durations below: the tween writes a frame every TWEEN_FRAME_MS
// (40 ms), so every fade a test steps through is a whole number of frames.
// A 500 ms fade under this harness lands its last frame at 480 and schedules
// 520 — `advance(500)` would leave the tween one frame short of t = 1 for ever.
function makeFollowCA(cfgFile = tmpCfg()) {
  const writes = [];
  let nowMs = 0;
  const queue = [];
  const signals = { audioNote: 0, audioNoteHue: 0 };
  const subs = [];
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  const ca = new ColorAutopilot(
    () => { throw new Error('applyPalette must never run in follow-note mode'); },
    cfgFile,
    {
      applyParamsFn: (p) => writes.push(p),
      now: () => nowMs,
      scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
      clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
      getSignalFn: (k) => signals[k],
      subscribeSignalsFn: (fn) => {
        subscribeCount++;
        subs.push(fn);
        return () => { unsubscribeCount++; const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
      },
    },
  );
  function publish() { for (const fn of [...subs]) fn(); }
  function setNote(pc, hue) { signals.audioNote = pc; signals.audioNoteHue = hue; publish(); }
  function advance(ms) {
    const target = nowMs + ms;
    let guard = 0;
    for (;;) {
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
  return {
    ca, writes, setNote, publish, advance, signals,
    now: () => nowMs,
    setNow: (v) => { nowMs = v; },
    liveSubs: () => subs.length,
    counts: () => ({ subscribeCount, unsubscribeCount }),
  };
}

const last = (a) => a[a.length - 1];
const pairOf = (scheme, hue, sel = [0, 1]) => {
  const ring = generateScheme(scheme, hue);
  return { colorPalette1: ring[sel[0]], colorPalette2: ring[sel[1]] };
};

// ══ W2 — the wire and its validator (docs/59 §4.1) ══════════════════════════

test('validate accepts a follow-note wire and fills every field', () => {
  const out = ColorAutopilot.validate(followWire());
  assert.deepEqual(out, {
    active: true,
    mode: 'followNote',
    followNote: {
      schemes: SEVEN, methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false,
    },
  });
});

test('validate fills the follow-note DEFAULTS when the block only names its schemes', () => {
  const out = ColorAutopilot.validate({ active: true, mode: 'followNote', followNote: { schemes: ['triadic'] } });
  assert.deepEqual(out.followNote,
    { schemes: ['triadic'], methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false });
});

test('an ABSENT mode is the legacy palettes mode, byte-understood', () => {
  assert.equal(colorAutopilotMode({ active: true, palettes: ['aurora'], delay_s: 5 }), 'palettes');
  assert.equal(colorAutopilotMode(undefined), 'palettes');
  const out = ColorAutopilot.validate({ active: true, palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5 });
  assert.equal(out.mode, 'palettes');
  assert.deepEqual(out.palettes, [{ c1: 0.1, c2: 0.6 }]);
});

test('validate REFUSES an unknown mode by name rather than treating it as legacy', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, mode: 'followBeat', palettes: ['a'], delay_s: 1 }),
    /mode must be one of palettes, followNote/);
});

test('follow-note mode FORBIDS every palettes-mode field, naming the offender', () => {
  for (const [field, value] of [['palettes', ['aurora']], ['delay_s', 5], ['transitionMs', 800], ['shuffle', true]]) {
    assert.throws(
      () => ColorAutopilot.validate({ ...followWire(), [field]: value }),
      new RegExp(`does not take '${field}'`),
      `mixing ${field} into a follow-note config must be refused`);
  }
});

test('follow-note mode REQUIRES its block', () => {
  assert.throws(
    () => ColorAutopilot.validate({ active: true, mode: 'followNote' }),
    /requires a followNote block/);
});

test('validate refuses an unknown scheme id, naming it', () => {
  assert.throws(
    () => ColorAutopilot.validate(followWire({ schemes: ['triadic', 'kaleidoscope'] })),
    /schemes\[1\] "kaleidoscope" is not a known scheme id/);
});

test('validate refuses an EMPTY method subset — the cycle needs a method', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ schemes: [] })),
    /schemes must be a non-empty array/);
});

test('validate refuses a REPEATED method — the cycle is a SET', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ schemes: ['triadic', 'split', 'triadic'] })),
    /lists "triadic" twice/);
});

test('validate refuses the method-cycle SPIN LOOP (zero hold + near-zero fade)', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ methodHoldS: 0, methodFadeS: 0.05 })),
    /methodHoldS 0 \(continuous\) requires methodFadeS >= 0\.1/);
  // …and ACCEPTS continuous with a real fade, which is a legitimate choice.
  const ok = ColorAutopilot.validate(followWire({ methodHoldS: 0, methodFadeS: 1.5 }));
  assert.equal(ok.followNote.methodHoldS, 0);
});

test('validate refuses a zero / negative method fade and a negative hold', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ methodFadeS: 0 })), /methodFadeS must be a number > 0/);
  assert.throws(() => ColorAutopilot.validate(followWire({ methodFadeS: -1 })), /methodFadeS must be a number >= 0/);
  assert.throws(() => ColorAutopilot.validate(followWire({ methodHoldS: -5 })), /methodHoldS must be a number >= 0/);
});

test('validate refuses a negative / non-finite noteFadeMs but ACCEPTS 0 (snap)', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ noteFadeMs: -1 })), /noteFadeMs must be a number >= 0/);
  assert.throws(() => ColorAutopilot.validate(followWire({ noteFadeMs: NaN })), /noteFadeMs must be a number >= 0/);
  assert.equal(ColorAutopilot.validate(followWire({ noteFadeMs: 0 })).followNote.noteFadeMs, 0);
});

test('validate refuses a bad A/B slot selection', () => {
  assert.throws(() => ColorAutopilot.validate(followWire({ sel: [2, 2] })), /picks slot 2 for BOTH channels/);
  assert.throws(() => ColorAutopilot.validate(followWire({ sel: [0, 5] })), /must be an integer ring index in \[0,5\)/);
  assert.throws(() => ColorAutopilot.validate(followWire({ sel: [0] })), /two-element array of ring indices/);
  assert.throws(() => ColorAutopilot.validate(followWire({ sel: [0, 1.5] })), /must be an integer ring index/);
});

test('validate accepts a method OVERRIDE outside the cycle subset, but not outside the nine', () => {
  // Tapping a chip that is toggled OFF means "show me this one NOW"; the cycle
  // then resumes from the subset. An id outside the nine is still a refusal.
  const out = ColorAutopilot.validate(followWire({ schemes: ['triadic'], method: 'golden' }));
  assert.equal(out.followNote.method, 'golden');
  assert.throws(() => ColorAutopilot.validate(followWire({ method: 'nope' })), /method "nope" is not a known scheme id/);
});

test('a palettes-mode config may CARRY an inert follow-note block, validated', () => {
  const wire = {
    active: true, palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5,
    followNote: { schemes: ['triadic'], methodHoldS: 30 },
  };
  const out = ColorAutopilot.validate(wire);
  assert.equal(out.mode, 'palettes');
  assert.equal(out.followNote.methodHoldS, 30);
  // It is validated on the way in, so a mode toggle a week later cannot fail on
  // a block that was stored broken.
  assert.throws(() => ColorAutopilot.validate({ ...wire, followNote: { schemes: ['bogus'] } }),
    /is not a known scheme id/);
});

test('validateFollowNote labels its refusals with the caller-supplied path', () => {
  assert.throws(() => validateFollowNote({ schemes: [] }, 'cue.colorAutopilot.followNote'),
    /cue\.colorAutopilot\.followNote\.schemes/);
});

// ══ mergeWire — the mode-aware REST merge ═══════════════════════════════════

test('mergeWire does NOT drag palettes-mode fields into a follow-note start', () => {
  const live = { active: false, mode: 'palettes', palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5, shuffle: false, transitionMs: 800 };
  const merged = ColorAutopilot.mergeWire(live, followWire());
  assert.equal(merged.palettes, undefined);
  assert.equal(merged.delay_s, undefined);
  // …and the result is something `validate` actually accepts, which is the
  // whole point: without this, START FOLLOW NOTE would 400 every time.
  assert.equal(ColorAutopilot.validate(merged).mode, 'followNote');
});

test('mergeWire carries the INERT block across a mode toggle, so tuning round-trips', () => {
  const followState = { active: true, mode: 'followNote', followNote: { schemes: ['triadic'], methodHoldS: 120, methodFadeS: 6, noteFadeMs: 0, sel: [1, 3], shuffle: false } };
  const backToPalettes = ColorAutopilot.mergeWire(followState, {
    active: true, mode: 'palettes', palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5, transitionMs: 800,
  });
  assert.deepEqual(backToPalettes.followNote, followState.followNote);
  const backToFollow = ColorAutopilot.mergeWire(ColorAutopilot.validate(backToPalettes), { active: true, mode: 'followNote' });
  assert.deepEqual(ColorAutopilot.validate(backToFollow).followNote, followState.followNote);
});

test('mergeWire merges a SPARSE followNote over the live block, not over nothing', () => {
  const live = { active: true, mode: 'followNote', followNote: { schemes: ['triadic', 'split'], methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false } };
  const merged = ColorAutopilot.mergeWire(live, { followNote: { methodHoldS: 120 } });
  assert.deepEqual(merged.followNote.schemes, ['triadic', 'split']);
  assert.equal(merged.followNote.methodHoldS, 120);
});

test('a mode-LESS palettes body still means palettes, even while follow-note is running', () => {
  // THE BACK-COMPAT CONTRACT. Every caller written before this feature POSTs
  // `{active, palettes, delay_s, …}` with no `mode` at all — the timeline cue
  // path, older CaptainPad builds, hand-rolled scripts. Inheriting the LIVE
  // mode meant that once FOLLOW NOTE had been used once, every one of those
  // came back 400 with "does not take 'palettes'". Caught by
  // color_window_engine_api against a rig whose persisted block had been left
  // in follow-note mode — i.e. the state the operator's engine is in after
  // trying the feature.
  const liveFollow = { active: true, mode: 'followNote', followNote: { schemes: ['triadic'], methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false } };
  const merged = ColorAutopilot.mergeWire(liveFollow, {
    active: true, palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5, transitionMs: 800,
  });
  assert.equal(merged.mode, 'palettes');
  const out = ColorAutopilot.validate(merged);
  assert.equal(out.mode, 'palettes');
  // …and the follow-note tuning is still carried, inert, so the toggle back
  // does not have to re-send it.
  assert.deepEqual(out.followNote.schemes, ['triadic']);
});

test('a mode-LESS follow-note body means follow-note, even while a ring is running', () => {
  const liveRing = { active: true, mode: 'palettes', palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5, shuffle: false, transitionMs: 800 };
  const merged = ColorAutopilot.mergeWire(liveRing, { active: true, followNote: { schemes: ['golden'] } });
  assert.equal(merged.mode, 'followNote');
  assert.equal(ColorAutopilot.validate(merged).followNote.schemes[0], 'golden');
});

test('a body that names NEITHER mode\'s fields keeps the live one (a bare stop)', () => {
  const liveFollow = { active: true, mode: 'followNote', followNote: { schemes: ['triadic'], methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false } };
  const merged = ColorAutopilot.mergeWire(liveFollow, { active: false });
  assert.equal(merged.mode, 'followNote');
  assert.equal(ColorAutopilot.validate(merged).active, false);
});

test('a body carrying BOTH modes\' fields is ambiguous — it is REFUSED, never guessed', () => {
  const liveRing = { active: true, mode: 'palettes', palettes: [{ c1: 0.1, c2: 0.6 }], delay_s: 5, shuffle: false, transitionMs: 800 };
  const merged = ColorAutopilot.mergeWire(liveRing, {
    active: true, palettes: [{ c1: 0.2, c2: 0.7 }], followNote: { schemes: ['golden'] },
  });
  // It keeps the live mode and lets `validate` say what is wrong. The one thing
  // that must never happen is quietly picking one half of the body.
  assert.equal(merged.mode, 'palettes');
  const explicit = ColorAutopilot.mergeWire(liveRing, {
    active: true, mode: 'followNote', palettes: [{ c1: 0.2, c2: 0.7 }], followNote: { schemes: ['golden'] },
  });
  assert.throws(() => ColorAutopilot.validate(explicit), /does not take 'palettes'/);
});

test('mergeWire keeps the legacy palettes merge byte-identical', () => {
  const live = { active: true, mode: 'palettes', palettes: ['aurora'], delay_s: 5, shuffle: false, transitionMs: 800 };
  assert.deepEqual(ColorAutopilot.mergeWire(live, { delay_s: 10 }),
    { active: true, mode: 'palettes', palettes: ['aurora'], delay_s: 10, shuffle: false, transitionMs: 800 });
});

// ══ W3 — the two loops (docs/59 §4.2) ═══════════════════════════════════════

test('a START puts the first ring on the rig at once — not after a 60 s hold', () => {
  const h = makeFollowCA();
  h.signals.audioNote = 4;
  h.signals.audioNoteHue = 0.25;
  h.ca.setState(ColorAutopilot.validate(followWire()));
  // No `from` yet → the first apply lands directly on the target.
  assert.equal(h.writes.length, 1);
  assert.deepEqual(last(h.writes), pairOf('complement', 0.25));
  assert.equal(h.ca.currentScheme, 'complement');
  h.ca.stop();
});

test('a NOTE CHANGE slews the pair over noteFadeMs, ending exactly on the new ring', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  const start = last(h.writes);
  h.writes.length = 0;
  h.setNote(4, 0.25);
  // The ramp starts moving on the event itself (t = 0 frame), not a frame later.
  assert.ok(h.writes.length >= 1);
  assert.deepEqual(h.writes[0], { colorPalette1: start.colorPalette1, colorPalette2: start.colorPalette2 });
  h.advance(400);
  assert.deepEqual(last(h.writes), pairOf('complement', 0.25));
  // …and it took the WHOLE fade to get there: a mid-fade sample is genuinely
  // between the endpoints, which is what makes this a slew and not a snap.
  const mid = h.writes[Math.floor(h.writes.length / 2)];
  assert.notDeepEqual(mid, pairOf('complement', 0.25));
  h.ca.stop();
});

test('noteFadeMs 0 SNAPS — the Live Touch parity escape hatch', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ noteFadeMs: 0 })));
  h.writes.length = 0;
  h.setNote(7, 0.61803);
  assert.equal(h.writes.length, 1, 'a snap is exactly one write');
  assert.deepEqual(h.writes[0], pairOf('complement', 0.61803));
  h.ca.stop();
});

test('an UNCHANGED note publishes nothing — the hop-rate subscriber is free', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  h.setNote(4, 0.25);
  h.advance(400);
  h.writes.length = 0;
  for (let i = 0; i < 50; i++) h.publish();
  assert.deepEqual(h.writes, [], '50 CPC events on a held note must write nothing at all');
  h.ca.stop();
});

test('a COMMITTED note change re-broadcasts, so the card\'s note letter is not a hold behind', () => {
  // Measured on the offline walk before this hook existed: the rig had moved to
  // G while the card still said E, because nothing re-broadcast between method
  // advances (up to 60 s by default). It fires on CHANGE only — the hop-rate
  // republishes below never reach it.
  const notes = [];
  const h = makeFollowCA();
  h.ca.onNoteChange = () => notes.push([h.ca.notePc, h.ca.noteHue]);
  h.ca.setState(ColorAutopilot.validate(followWire()));
  h.setNote(4, 0.25);
  h.setNote(7, 0.61803);
  assert.deepEqual(notes, [[4, 0.25], [7, 0.61803]]);
  for (let i = 0; i < 30; i++) h.publish();
  assert.equal(notes.length, 2, '30 republishes of the same note must not re-broadcast');
  h.ca.stop();
});

test('a MID-FADE note change retargets FROM the live params — no snap, no queue', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ noteFadeMs: 1000 })));
  h.setNote(1, 0.1);
  h.advance(500); // half-way to the 0.1 ring
  const midway = last(h.writes);
  h.writes.length = 0;
  h.setNote(8, 0.8);
  // The FIRST frame of the new fade is where the old one actually got to.
  assert.deepEqual(h.writes[0], { colorPalette1: midway.colorPalette1, colorPalette2: midway.colorPalette2 });
  h.advance(1000);
  assert.deepEqual(last(h.writes), pairOf('complement', 0.8));
  h.ca.stop();
});

test('a METHOD ADVANCE crossfades over methodFadeS and moves the cursor on', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ methodFadeS: 2 })));
  h.setNote(4, 0.25);
  h.advance(400);
  const before = last(h.writes);
  h.writes.length = 0;
  const tick = h.ca.triggerNext();
  assert.deepEqual(h.writes[0], { colorPalette1: before.colorPalette1, colorPalette2: before.colorPalette2 });
  h.advance(2000);
  await tick;
  assert.equal(h.ca.currentScheme, 'contrast');
  assert.deepEqual(last(h.writes), pairOf('contrast', 0.25));
  h.ca.stop();
});

test('hold and fade stay ADDITIVE — the next hold is armed only after the fade lands', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ methodHoldS: 10, methodFadeS: 2 })));
  h.setNote(4, 0.25);
  h.advance(400);
  const t0 = h.now();
  const tick = h.ca.triggerNext();
  h.advance(2000);
  await tick;
  // Armed at (tick + fade), not at (tick): 10 s of hold AFTER the 2 s fade.
  assert.equal(h.ca.nextSwapAtMs, t0 + 2000 + 10000);
  h.ca.stop();
});

test('SHUFFLE never repeats the method it just played', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ schemes: ['triadic', 'split', 'golden'], methodFadeS: 0.1, shuffle: true })));
  let prev = h.ca.currentScheme;
  for (let i = 0; i < 25; i++) {
    const tick = h.ca.triggerNext();
    h.advance(200);
    await tick;
    assert.notEqual(h.ca.currentScheme, prev, 'shuffle must not repeat the immediately-previous method');
    prev = h.ca.currentScheme;
  }
  h.ca.stop();
});

test('the CPC subscription is taken on activate and RELEASED on stop', () => {
  const h = makeFollowCA();
  assert.equal(h.liveSubs(), 0);
  h.ca.setState(ColorAutopilot.validate(followWire()));
  assert.equal(h.liveSubs(), 1);
  h.ca.stop();
  assert.equal(h.liveSubs(), 0, 'a stopped daemon that kept listening would keep writing the palette');
  assert.equal(h.counts().unsubscribeCount, 1);
});

test('DEACTIVATE (the deck-pin release path) releases the subscription too', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  h.ca.deactivate();
  assert.equal(h.liveSubs(), 0);
  assert.equal(h.ca.state.active, false);
  // …and a note change after the release writes nothing.
  h.writes.length = 0;
  h.setNote(9, 0.9);
  assert.deepEqual(h.writes, []);
});

test('setting mode BACK to palettes releases the note subscription', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  assert.equal(h.liveSubs(), 1);
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }], delay_s: 5 }));
  assert.equal(h.liveSubs(), 0);
  h.ca.stop();
});

test('a follow-note config WITHOUT the CPC hooks throws — no silent frozen hue', () => {
  const ca = new ColorAutopilot(() => {}, tmpCfg(), { applyParamsFn: () => {} });
  assert.throws(() => ca.setState(ColorAutopilot.validate(followWire())),
    /mode 'followNote' requires the getSignalFn, subscribeSignalsFn and applyParamsFn hooks/);
  ca.stop();
});

test('CRASH-BOOT resumes following: the runtime file round-trips mode + block', () => {
  const cfg = tmpCfg();
  const a = makeFollowCA(cfg);
  a.ca.setState(ColorAutopilot.validate(followWire({ schemes: ['split', 'tetrad'], methodHoldS: 120, sel: [1, 4] })));
  a.ca.stop();

  const b = makeFollowCA(cfg);
  assert.equal(b.ca.mode, 'followNote');
  assert.deepEqual(b.ca.state.followNote.schemes, ['split', 'tetrad']);
  assert.deepEqual(b.ca.state.followNote.sel, [1, 4]);
  b.signals.audioNote = 2;
  b.signals.audioNoteHue = 0.61803;
  b.ca.start();
  assert.deepEqual(last(b.writes), pairOf('split', 0.61803, [1, 4]));
  b.ca.stop();
});

test('HOLD-LAST is the silence behaviour: a dead feed writes nothing and the cycle keeps breathing', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ methodFadeS: 0.4 })));
  h.setNote(4, 0.25);
  h.advance(400);
  const heldHue = h.signals.audioNoteHue;
  h.writes.length = 0;
  // The companion dies: no more CPC events at all. Nothing is written, and the
  // rig stays exactly where it was — no wheel-base fallback, no invented colour.
  assert.deepEqual(h.writes, []);
  // …and the METHOD cycle carries on, on the held hue (the show keeps breathing).
  const tick = h.ca.triggerNext();
  h.advance(400);
  await tick;
  assert.deepEqual(last(h.writes), pairOf('contrast', heldHue));
  h.ca.stop();
});

// ══ W5 — LIVE RETUNE (docs/59 §5) ═══════════════════════════════════════════

test('patchState REFUSES active and mode — those are takeovers, not retunes', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  assert.throws(() => h.ca.patchState({ active: false }), /cannot change 'active'/);
  assert.throws(() => h.ca.patchState({ mode: 'palettes' }), /cannot change 'mode'/);
  h.ca.stop();
});

test('EVERY accepted patch leaves generation untouched', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  const gen = h.ca.generation;
  h.ca.patchState({ followNote: { methodHoldS: 30 } });
  h.ca.patchState({ followNote: { methodFadeS: 6 } });
  h.ca.patchState({ followNote: { noteFadeMs: 1000 } });
  h.ca.patchState({ followNote: { schemes: ['triadic', 'split'] } });
  h.ca.patchState({ followNote: { shuffle: true } });
  h.ca.patchState({ followNote: { sel: [2, 3] } });
  assert.equal(h.ca.generation, gen, 'a generation bump is what kills the in-flight tween — patch must never do it');
  h.ca.stop();
});

/**
 * THE HEADLINE ACCEPTANCE (docs/59 §5.3): a running crossfade retimed HOLD
 * 2 s → 10 s mid-hold. Zero writes outside tweens (no snap), the countdown
 * re-armed phase-preserving, the cursor untouched.
 */
function makePaletteCA(cfgFile = tmpCfg()) {
  const writes = [];
  let nowMs = 0;
  const queue = [];
  const RING = [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }];
  const resolve = (e) => ({ colorPalette1: { h: e.c1, s: 1, v: 1 }, colorPalette2: { h: e.c2, s: 1, v: 1 } });
  const ca = new ColorAutopilot((e) => { writes.push(resolve(e)); }, cfgFile, {
    resolvePaletteFn: resolve,
    applyParamsFn: (p) => writes.push(p),
    now: () => nowMs,
    scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
    clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
  });
  function advance(ms) {
    const target = nowMs + ms;
    for (;;) {
      const next = queue.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      nowMs = next.at;
      next.fn();
    }
    nowMs = target;
  }
  return { ca, writes, advance, RING, now: () => nowMs };
}

test('a running HARD-CUT crossfade retimed HOLD 2 s → 10 s: phase preserved, nothing snaps', async () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 2, transitionMs: 0 }));
  await h.ca.triggerNext();          // land on pair 0
  const tickAt = h.ca._lastTickAtMs;
  const cursor = h.ca._cursor;
  h.advance(1200);                   // 1.2 s into the 2 s hold
  h.writes.length = 0;

  h.ca.patchState({ delay_s: 10 });

  // NO write happened: a retune is a timing change, not a colour change.
  assert.deepEqual(h.writes, []);
  // With a hard cut the hold begins at the tick, so this is docs/59 §5.3's
  // stated identity, exactly.
  assert.equal(h.ca.nextSwapAtMs, tickAt + 10000);
  assert.equal(h.ca._cursor, cursor, 'the rotation keeps its place');
  assert.equal(h.ca.state.delay_s, 10);
  h.ca.stop();
});

test('the hold re-arm is PHASE-PRESERVING with a fade too — measured from the hold, not the tick', async () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 2, transitionMs: 800 }));
  const tick = h.ca.triggerNext();
  h.advance(800);
  await tick;
  const holdStart = h.ca._holdStartedAtMs;
  // With a real fade the hold begins AFTER it lands, so `lastTickAtMs + hold`
  // would silently eat the fade out of the cycle and break the additive
  // scheduling contract. Phase preservation means the elapsed hold survives.
  assert.equal(holdStart, h.ca._lastTickAtMs + 800);
  h.advance(500);
  h.ca.patchState({ delay_s: 10 });
  assert.equal(h.ca.nextSwapAtMs, holdStart + 10000);
  h.ca.stop();
});

test('a hold retuned SHORTER than the elapsed time fires now-ish, never negative', async () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 30, transitionMs: 0 }));
  await h.ca.triggerNext();
  h.advance(20000);
  h.ca.patchState({ delay_s: 5 });
  assert.equal(h.ca.nextSwapAtMs, h.ca._holdStartedAtMs + 5000);
  assert.ok(h.ca.nextSwapAtMs < h.now(), 'already past — the re-arm fires immediately rather than waiting again');
  h.ca.stop();
});

test('FADE 0.4 s → 3 s patched MID-FADE: the current fade lands at 0.4 s, the next runs 3 s', async () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 5, transitionMs: 400 }));
  await h.ca.triggerNext();                       // seed pair 0 (no `from` → snap)
  const first = h.ca.triggerNext();               // fade toward pair 1
  h.advance(200);
  h.ca.patchState({ transitionMs: 3000 });
  const t0 = h.now();
  h.advance(200);
  await first;                                    // landed at its ORIGINAL 400 ms
  assert.equal(h.now() - t0, 200);
  assert.deepEqual(h.ca._currentParams, { colorPalette1: { h: 0.6, s: 1, v: 1 }, colorPalette2: { h: 0.1, s: 1, v: 1 } });

  const second = h.ca.triggerNext();              // …the NEXT one uses 3 s
  h.advance(1500);
  assert.notDeepEqual(h.ca._currentParams, { colorPalette1: { h: 0.1, s: 1, v: 1 }, colorPalette2: { h: 0.6, s: 1, v: 1 } });
  h.advance(1500);
  await second;
  assert.deepEqual(h.ca._currentParams, { colorPalette1: { h: 0.1, s: 1, v: 1 }, colorPalette2: { h: 0.6, s: 1, v: 1 } });
  h.ca.stop();
});

test('a RING RESTAGE mid-hold writes nothing, then fades from the live params to the NEW ring', async () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 5, transitionMs: 400 }));
  await h.ca.triggerNext();
  const live = h.ca._currentParams;
  h.advance(2000);
  h.writes.length = 0;

  const NEW = [{ c1: 0.2, c2: 0.9 }, { c1: 0.9, c2: 0.2 }];
  h.ca.patchState({ palettes: NEW });
  assert.deepEqual(h.writes, [], 'no write lands between the patch and the tick');
  assert.equal(h.ca._cursor, 0, 'the cursor is preserved, so the cadence keeps its place');

  const tick = h.ca.triggerNext();
  assert.deepEqual(h.writes[0], { colorPalette1: live.colorPalette1, colorPalette2: live.colorPalette2 },
    'the fade starts from where the rig actually is — no dark frame, no cut');
  h.advance(400);
  await tick;
  assert.deepEqual(h.ca._currentParams, { colorPalette1: { h: 0.9, s: 1, v: 1 }, colorPalette2: { h: 0.2, s: 1, v: 1 } });
  h.ca.stop();
});

test('a restage to a SHORTER ring clamps the cursor instead of indexing past the end', async () => {
  const h = makePaletteCA();
  const five = [0, 1, 2, 3, 4].map((i) => ({ c1: i / 5, c2: ((i + 1) % 5) / 5 }));
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: five, delay_s: 5, transitionMs: 0 }));
  for (let i = 0; i < 4; i++) await h.ca.triggerNext();
  assert.equal(h.ca._cursor, 3);
  h.ca.patchState({ palettes: h.RING });
  assert.equal(h.ca._cursor, 1);
  h.ca.stop();
});

test('patchState refuses a CONT hold that would spin-loop against the LIVE fade', () => {
  const h = makePaletteCA();
  h.ca.setState(ColorAutopilot.validate({ active: true, palettes: h.RING, delay_s: 5, transitionMs: 0 }));
  assert.throws(() => h.ca.patchState({ delay_s: 0 }),
    /delay_s 0 \(continuous\) requires transitionMs >= 100, the live transitionMs is 0/);
  // The same patch is FINE once there is a real fade to occupy the cycle.
  h.ca.patchState({ transitionMs: 1500 });
  h.ca.patchState({ delay_s: 0 });
  assert.equal(h.ca.state.delay_s, 0);
  h.ca.stop();
});

test('patchState refuses a field belonging to the OTHER mode, naming both', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire()));
  assert.throws(() => h.ca.patchState({ delay_s: 5 }), /'delay_s' is a palettes-mode field, but the daemon is running mode 'followNote'/);
  h.ca.stop();

  const p = makePaletteCA();
  p.ca.setState(ColorAutopilot.validate({ active: true, palettes: p.RING, delay_s: 5, transitionMs: 0 }));
  assert.throws(() => p.ca.patchState({ followNote: { methodHoldS: 30 } }),
    /'followNote' is a follow-note field, but the daemon is running mode 'palettes'/);
  p.ca.stop();
});

test('a METHOD SUBSET swapped mid-hold: the current method finishes, the next advance is from the new set', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ schemes: ['complement', 'contrast'], methodFadeS: 0.4 })));
  h.setNote(4, 0.25);
  h.advance(400);
  assert.equal(h.ca.currentScheme, 'complement');
  h.writes.length = 0;

  h.ca.patchState({ followNote: { schemes: ['triadic', 'golden'] } });
  assert.deepEqual(h.writes, [], 'a subset swap is not a colour change — it writes nothing now');
  assert.equal(h.ca.currentScheme, 'triadic', 'the cursor is preserved, so slot 0 of the NEW subset is next in line');

  const tick = h.ca.triggerNext();
  h.advance(400);
  await tick;
  assert.equal(h.ca.currentScheme, 'golden');
  assert.deepEqual(last(h.writes), pairOf('golden', 0.25));
  h.ca.stop();
});

test('a SEL patch is IMMEDIATE — it retweens to the newly selected pair over noteFadeMs', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ schemes: ['contrast'], noteFadeMs: 200 })));
  h.setNote(4, 0.25);
  h.advance(400);
  h.writes.length = 0;
  h.ca.patchState({ followNote: { sel: [2, 4] } });
  assert.ok(h.writes.length >= 1, 'a pair re-selection is a colour choice NOW');
  h.advance(200);
  assert.deepEqual(last(h.writes), pairOf('contrast', 0.25, [2, 4]));
  h.ca.stop();
});

test('a METHOD OVERRIDE (the scheme tap) tweens over methodFadeS and the cycle resumes from there', async () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate(followWire({ schemes: ['complement', 'contrast', 'triadic'], methodFadeS: 1 })));
  h.setNote(4, 0.25);
  h.advance(400);
  h.writes.length = 0;

  h.ca.patchState({ followNote: { method: 'golden' } });
  h.advance(1000);
  assert.equal(h.ca.currentScheme, 'golden');
  assert.deepEqual(last(h.writes), pairOf('golden', 0.25));

  // "…cycle continues from here": the next advance picks the subset's first
  // entry and the override is CONSUMED, so it cannot resurrect on a crash-boot.
  const tick = h.ca.triggerNext();
  h.advance(1000);
  await tick;
  assert.equal(h.ca.currentScheme, 'complement');
  assert.equal(h.ca.state.followNote.method, undefined);
  h.ca.stop();
});

test('a patch while PARKED edits the config without arming anything', () => {
  const h = makeFollowCA();
  h.ca.setState(ColorAutopilot.validate({ ...followWire(), active: false }));
  assert.equal(h.ca.nextSwapAtMs, null);
  h.writes.length = 0;
  h.ca.patchState({ followNote: { methodHoldS: 30 } });
  assert.equal(h.ca.state.followNote.methodHoldS, 30);
  assert.equal(h.ca.nextSwapAtMs, null, 'there are no timers to re-arm on a parked config');
  assert.deepEqual(h.writes, []);
  h.ca.stop();
});

test('a patched follow-note block SURVIVES a restart', () => {
  const cfg = tmpCfg();
  const a = makeFollowCA(cfg);
  a.ca.setState(ColorAutopilot.validate(followWire()));
  a.ca.patchState({ followNote: { methodHoldS: 300, noteFadeMs: 0 } });
  a.ca.stop();
  const b = makeFollowCA(cfg);
  assert.equal(b.ca.state.followNote.methodHoldS, 300);
  assert.equal(b.ca.state.followNote.noteFadeMs, 0);
  b.ca.stop();
});
