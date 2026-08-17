// show_autopilot_logic — the SHOW AUTOPILOT card's pill mapping (docs/57 §4,
// report `_240`).
//
// The card draws name, PLAY/PAUSE, time pills, and SINGLE/SHUFFLE ALL. It must
// never lie about an authored cadence that is not
// one of the four pills lights NO pill and prints itself instead. These tests
// pin that, plus the minutes↔seconds mapping the wire speaks.

import { describe, expect, it } from 'vitest';

import {
  PILL_SECONDS,
  TRANSITION_SELECTIONS,
  formatCadence,
  litPillSeconds,
  offPillCaption,
  pillSeconds,
} from './show_autopilot_logic';

describe('show autopilot pills', () => {
  it('is exactly the operator\'s four pills, in SECONDS', () => {
    expect([...PILL_SECONDS]).toEqual([5, 15, 30, 60]);
    // All inside the schema's 1..3600 `everySec` bound.
    for (const sec of PILL_SECONDS) {
      expect(sec).toBeGreaterThanOrEqual(1);
      expect(sec).toBeLessThanOrEqual(3600);
    }
  });

  it('maps a pill to the everySec the wire speaks', () => {
    expect(pillSeconds(5)).toBe(5);
    expect(pillSeconds(15)).toBe(15);
    expect(pillSeconds(30)).toBe(30);
    expect(pillSeconds(60)).toBe(60);
  });

  it('lights the pill that matches the live cadence', () => {
    expect(litPillSeconds(5)).toBe(5);
    expect(litPillSeconds(15)).toBe(15);
    expect(litPillSeconds(30)).toBe(30);
    expect(litPillSeconds(60)).toBe(60);
  });

  // The card never snaps a value it did not set. An authored `everySec: 20`
  // (or any hand-tuned number) lights nothing and is printed verbatim.
  it('lights NOTHING for a cadence that matches no pill, and captions it', () => {
    for (const odd of [20, 45, 120, 899, 3600]) {
      expect(litPillSeconds(odd)).toBeNull();
      expect(offPillCaption(odd)).not.toBeNull();
    }
    expect(offPillCaption(20)).toBe('20 SEC');
    expect(offPillCaption(120)).toBe('2 MIN');
    expect(offPillCaption(90)).toBe('1 MIN 30 SEC');
  });

  it('shows no caption when a pill already says it', () => {
    for (const sec of PILL_SECONDS) expect(offPillCaption(sec)).toBeNull();
  });

  // An unsupported stage carries `everySec: null` — the card must render, not
  // crash, and light nothing.
  it('handles a null / non-finite cadence without inventing one', () => {
    expect(litPillSeconds(null)).toBeNull();
    expect(offPillCaption(null)).toBeNull();
    expect(litPillSeconds(Number.NaN)).toBeNull();
    expect(offPillCaption(Number.NaN)).toBeNull();
  });

  it('speaks a cadence the way an operator would say it', () => {
    expect(formatCadence(0)).toBe('0 SEC');
    expect(formatCadence(59)).toBe('59 SEC');
    expect(formatCadence(60)).toBe('1 MIN');
    expect(formatCadence(900)).toBe('15 MIN');
    expect(formatCadence(3661)).toBe('61 MIN 1 SEC');
  });
});

describe('show autopilot transition selection', () => {
  it('offers exactly SINGLE or SHUFFLE ALL without inventing another mode', () => {
    expect(TRANSITION_SELECTIONS).toEqual([
      { label: 'SINGLE', shuffle: false },
      { label: 'SHUFFLE ALL', shuffle: true },
    ]);
  });
});
