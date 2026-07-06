import { describe, it, expect, vi } from 'vitest';
import {
  LearnController, scaleMidiToRange, controlRefFromEvent, bindingMatches,
  describeControlRef, pickup, freshPickup,
} from './learn';
import { decodeMidi } from './midi_message';

describe('scaleMidiToRange', () => {
  it('maps 0-127 across [min, max]', () => {
    expect(scaleMidiToRange(0, [0, 1])).toBe(0);
    expect(scaleMidiToRange(127, [0, 1])).toBe(1);
    expect(scaleMidiToRange(64, [0, 1])).toBeCloseTo(64 / 127, 6);
  });
  it('supports inverted + offset ranges and clamps out-of-spec bytes', () => {
    expect(scaleMidiToRange(0, [1, 0])).toBe(1);
    expect(scaleMidiToRange(127, [1, 0])).toBe(0);
    expect(scaleMidiToRange(200, [0, 1])).toBe(1); // clamped
    expect(scaleMidiToRange(-5, [0, 1])).toBe(0); // clamped
  });
});

describe('controlRefFromEvent', () => {
  it('captures a CC as a continuous control', () => {
    expect(controlRefFromEvent(decodeMidi([0xb0, 51, 90]))).toEqual({
      ref: { type: 'cc', channel: 0, number: 51 }, value: 90, continuous: true,
    });
  });
  it('captures a Note On as a discrete control', () => {
    expect(controlRefFromEvent(decodeMidi([0x90, 40, 127]))).toEqual({
      ref: { type: 'note', channel: 0, number: 40 }, value: 127, continuous: false,
    });
  });
  it('never captures Note Off / other', () => {
    expect(controlRefFromEvent(decodeMidi([0x80, 40, 0]))).toBeNull();
    expect(controlRefFromEvent(decodeMidi([0x90, 40, 0]))).toBeNull(); // vel 0 = note off
    expect(controlRefFromEvent(decodeMidi([0xf0]))).toBeNull();
  });
});

describe('bindingMatches', () => {
  it('matches a CC binding to its CC event', () => {
    const ctl = { type: 'cc' as const, channel: 0, number: 51 };
    expect(bindingMatches(ctl, decodeMidi([0xb0, 51, 10]))).toBe(true);
    expect(bindingMatches(ctl, decodeMidi([0xb0, 52, 10]))).toBe(false); // different cc
    expect(bindingMatches(ctl, decodeMidi([0xb1, 51, 10]))).toBe(false); // different channel
  });
  it('matches a note binding on Note On only', () => {
    const ctl = { type: 'note' as const, channel: 0, number: 40 };
    expect(bindingMatches(ctl, decodeMidi([0x90, 40, 127]))).toBe(true);
    expect(bindingMatches(ctl, decodeMidi([0x80, 40, 0]))).toBe(false); // note off never drives
  });
});

describe('describeControlRef', () => {
  it('reads CC and Note compactly', () => {
    expect(describeControlRef({ type: 'cc', channel: 0, number: 54 })).toBe('CC 54');
    expect(describeControlRef({ type: 'note', channel: 2, number: 40 })).toBe('Note 40 ch3');
  });
});

describe('LearnController', () => {
  it('arms, captures the next control once, then disarms', () => {
    const lc = new LearnController();
    const cb = vi.fn();
    expect(lc.isArmed()).toBe(false);
    lc.arm(cb);
    expect(lc.isArmed()).toBe(true);
    expect(lc.capture({ type: 'cc', channel: 0, number: 51 })).toBe(true);
    expect(cb).toHaveBeenCalledWith({ ref: { type: 'cc', channel: 0, number: 51 } });
    expect(lc.isArmed()).toBe(false);
    // A second control after capture is not consumed.
    expect(lc.capture({ type: 'cc', channel: 0, number: 52 })).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('reportConflict delivers a conflict result once, then disarms', () => {
    const lc = new LearnController();
    const cb = vi.fn();
    lc.arm(cb);
    expect(lc.reportConflict('fader_7_speed')).toBe(true);
    expect(cb).toHaveBeenCalledWith({ conflict: 'fader_7_speed' });
    expect(lc.isArmed()).toBe(false);
    expect(lc.reportConflict('other')).toBe(false); // disarmed
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('reportReject delivers a rejection reason once, then disarms', () => {
    const lc = new LearnController();
    const cb = vi.fn();
    lc.arm(cb);
    expect(lc.reportReject("that's an endless encoder — knobs map by order, not by learn")).toBe(true);
    expect(cb).toHaveBeenCalledWith({ conflict: "that's an endless encoder — knobs map by order, not by learn" });
    expect(lc.isArmed()).toBe(false);
    expect(lc.reportReject('other')).toBe(false); // disarmed
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('cancel disarms without firing', () => {
    const lc = new LearnController();
    const cb = vi.fn();
    lc.arm(cb);
    lc.cancel();
    expect(lc.capture({ type: 'cc', channel: 0, number: 51 })).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });
  it("a stale token's cancel does not disarm a newer arm", () => {
    const lc = new LearnController();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const token1 = lc.arm(cb1); // first arm
    lc.arm(cb2);                // re-arm (newer); token1 is now stale
    lc.cancel(token1);          // stale cancel — must NOT disarm cb2
    expect(lc.isArmed()).toBe(true);
    expect(lc.capture({ type: 'cc', channel: 0, number: 51 })).toBe(true);
    expect(cb2).toHaveBeenCalledWith({ ref: { type: 'cc', channel: 0, number: 51 } });
    expect(cb1).not.toHaveBeenCalled();
  });
});

describe('pickup (soft-takeover)', () => {
  it('writes immediately when already unlocked', () => {
    const r = pickup({ locked: false, last: null }, 0.5, 0.9);
    expect(r.write).toBe(true);
    expect(r.next.locked).toBe(false);
  });
  it('stays locked while the fader is far from the current value', () => {
    let st = freshPickup(); // locked, last null
    const r1 = pickup(st, 0.5, 1.0); // far above
    expect(r1.write).toBe(false);
    expect(r1.next.locked).toBe(true);
    st = r1.next;
    const r2 = pickup(st, 0.5, 0.95); // still above, no crossing
    expect(r2.write).toBe(false);
  });
  it('unlocks + writes when the fader crosses the current value', () => {
    let st = freshPickup();
    st = pickup(st, 0.5, 1.0).next; // last = 1.0, locked
    const r = pickup(st, 0.5, 0.0); // crosses 0.5 downward
    expect(r.write).toBe(true);
    expect(r.next.locked).toBe(false);
  });
  it('unlocks when the fader lands within epsilon of the current value', () => {
    const r = pickup(freshPickup(), 0.5, 0.505);
    expect(r.write).toBe(true);
    expect(r.next.locked).toBe(false);
  });
});
