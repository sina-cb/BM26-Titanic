/**
 * Pinned derivations for the TIMELINE ZOOM ladder (reports _94 / _95).
 *
 * Three things are pinned here because getting them wrong is invisible on a
 * screenshot and expensive at 3 am on playa:
 *
 *   1. the midnight-WRAPPING phase band — `party_night` runs 21:34 → 05:23, and
 *      drawing that as one inverted rectangle makes a whole night look empty;
 *   2. the ribbon's literal "24:00" terminator (_95 §3.1: a 24 h column needs
 *      1440, not a next-day "00:00") and the `hold-expired-baseline` warn flag
 *      that makes _91's G1 visible instead of hidden;
 *   3. the BANNER COPY — the words the operator reads to answer "which clock is
 *      real", including the D3 deferred-show line, which must never say the
 *      show was cancelled (it is deferred; ENABLE still starts it now).
 */
import { describe, expect, it } from 'vitest';

import {
  localToMinutes,
  chartTapToLocal,
  phaseBands,
  allPhaseBands,
  ribbonRows,
  ribbonSourceNote,
  deferredShowText,
  zoomBannerModel,
  eventZoomMode,
  canPerform,
  shouldAnnounceZoomEnd,
  DAY_MINUTES,
  TRAVEL_TAP_SNAP_MIN,
} from './zoom_logic';

// Minimal wire fixtures — shaped exactly like the engine's own output.
const seg = (over: Partial<any> = {}) => ({
  fromMs: 0,
  toMs: 0,
  fromLocal: '00:00',
  toLocal: '06:08',
  owner: { kind: 'defaultCue' as const, cueId: null, label: 'Ambient program' },
  playlist: 'ambient',
  palette: 'deep_sea',
  controller: 'autopilot' as const,
  source: 'default-cue' as const,
  ...over,
});

describe('localToMinutes', () => {
  it('parses ordinary HH:MM', () => {
    expect(localToMinutes('00:00')).toBe(0);
    expect(localToMinutes('06:08')).toBe(368);
    expect(localToMinutes('23:59')).toBe(1439);
  });

  it('admits the ribbon terminator "24:00" as 1440', () => {
    // _95 §3.1: the LAST segment's toLocal is the literal "24:00", deliberately
    // not a next-day "00:00" — a 24 h column needs 1440 or the last band
    // collapses to zero height at the top of the chart.
    expect(localToMinutes('24:00')).toBe(DAY_MINUTES);
  });

  it('refuses anything else rather than guessing a time', () => {
    expect(localToMinutes('24:01')).toBeNull();
    expect(localToMinutes('25:00')).toBeNull();
    expect(localToMinutes('12:60')).toBeNull();
    expect(localToMinutes('sunset')).toBeNull();
    expect(localToMinutes(null)).toBeNull();
    expect(localToMinutes(undefined)).toBeNull();
  });
});

describe('chartTapToLocal — the bare-calendar TIME TRAVEL entry (2026-08-03)', () => {
  // The DAY chart is 720 px for 1440 min: 1 px = 2 min.
  const H = 720;

  it('maps a tap to the snapped HH:MM at that height', () => {
    expect(chartTapToLocal(0, H)).toBe('00:00');
    expect(chartTapToLocal(360, H)).toBe('12:00');
    // 21:07 (y=633.5 → 1267 min) snaps to the NEAREST 15-min notch → 21:00.
    expect(chartTapToLocal(633.5, H)).toBe('21:00');
  });

  it('clamps outside-the-chart geometry into the day', () => {
    expect(chartTapToLocal(-30, H)).toBe('00:00');
    // Past the bottom clamps to the LAST snappable instant, not "24:00" —
    // that string is the ribbon's terminator, never a travel target.
    expect(chartTapToLocal(H + 50, H)).toBe(`23:${60 - TRAVEL_TAP_SNAP_MIN}`);
  });

  it('pulls a snap that lands ON midnight back one notch', () => {
    // 23:56 (y=718) rounds up to 1440 → must come back to 23:45, not 24:00.
    expect(chartTapToLocal(718, H)).toBe('23:45');
  });

  it('returns null on unusable geometry rather than guessing a time', () => {
    expect(chartTapToLocal(Number.NaN, H)).toBeNull();
    expect(chartTapToLocal(100, 0)).toBeNull();
    expect(chartTapToLocal(100, Number.NaN)).toBeNull();
    expect(chartTapToLocal(100, H, 0)).toBeNull();
  });

  it('round-trips through localToMinutes (always a parseable target)', () => {
    for (const y of [0, 1, 137, 359.5, 707, 719, 720]) {
      const t = chartTapToLocal(y, H)!;
      const mins = localToMinutes(t);
      expect(mins).not.toBeNull();
      expect(mins! % TRAVEL_TAP_SNAP_MIN).toBe(0);
      expect(mins!).toBeLessThan(DAY_MINUTES);
    }
  });
});

describe('phaseBands', () => {
  it('draws an ordinary daytime band as one piece', () => {
    const b = phaseBands({ name: 'philharmonic', startLocal: '19:04', endLocal: '20:34' }, 0);
    expect(b).toEqual([
      { name: 'philharmonic', fromMin: 1144, toMin: 1234, wrapped: false, order: 0 },
    ]);
  });

  it('SPLITS a midnight-wrapping band into two pieces (the party_night case)', () => {
    // endLocal < startLocal means the band wraps. One inverted rectangle would
    // render nothing and the night would read as empty — this is the repro.
    const b = phaseBands({ name: 'party_night', startLocal: '21:34', endLocal: '05:23' }, 1);
    expect(b).toHaveLength(2);
    expect(b[0]).toEqual({ name: 'party_night', fromMin: 1294, toMin: DAY_MINUTES, wrapped: true, order: 1 });
    expect(b[1]).toEqual({ name: 'party_night', fromMin: 0, toMin: 323, wrapped: true, order: 1 });
  });

  it('draws NOTHING for a missing/polar sun anchor — never a guessed band', () => {
    expect(phaseBands({ name: 'x', startLocal: null, endLocal: '05:23' }, 0)).toEqual([]);
    expect(phaseBands({ name: 'x', startLocal: '21:00', endLocal: null }, 0)).toEqual([]);
  });

  it('drops a zero-length band', () => {
    expect(phaseBands({ name: 'x', startLocal: '21:00', endLocal: '21:00' }, 0)).toEqual([]);
  });

  it('preserves PLAN ORDER across all bands (overlap resolves first-in-order)', () => {
    const bands = allPhaseBands([
      { name: 'a', startLocal: '19:00', endLocal: '20:00' },
      { name: 'b', startLocal: '22:00', endLocal: '02:00' },
      { name: 'c', startLocal: '05:00', endLocal: '07:00' },
    ]);
    // b contributes two pieces; every piece keeps its source's plan index.
    expect(bands.map((b) => `${b.name}:${b.order}`)).toEqual(['a:0', 'b:1', 'b:1', 'c:2']);
  });

  it('is empty (not a crash) when the engine returned no phases', () => {
    expect(allPhaseBands(undefined)).toEqual([]);
  });
});

describe('ribbonRows', () => {
  it('projects a day that tiles 00:00 → 24:00', () => {
    const rows = ribbonRows([
      seg({ fromLocal: '00:00', toLocal: '06:08' }),
      seg({
        fromLocal: '06:08', toLocal: '07:53',
        owner: { kind: 'cue', cueId: 'c_sunrise', label: 'Sunrise' },
        playlist: 'default', palette: 'aurora', controller: 'program', source: 'cue',
      }),
      seg({
        fromLocal: '07:53', toLocal: '24:00',
        owner: { kind: 'cue', cueId: 'c_sunrise', label: 'Sunrise' },
        playlist: 'default', palette: 'aurora', controller: 'autopilot',
        source: 'hold-expired-baseline',
      }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].fromMin).toBe(0);
    expect(rows[2].toMin).toBe(DAY_MINUTES);
    expect(rows.map((r) => r.ownerLabel)).toEqual(['Ambient program', 'Sunrise', 'Sunrise']);
  });

  it('flags hold-expired-baseline as the WARN row (_91 G1 made visible)', () => {
    const rows = ribbonRows([
      seg({ source: 'cue' }),
      seg({ fromLocal: '06:08', toLocal: '24:00', source: 'hold-expired-baseline' }),
    ]);
    expect(rows[0].warn).toBe(false);
    expect(rows[1].warn).toBe(true);
    expect(ribbonSourceNote(rows[1])).toBe(
      'hold expired — the autopilot baseline plays under the cue',
    );
  });

  it('DROPS a segment whose times do not parse rather than placing it at 00:00', () => {
    const rows = ribbonRows([
      seg({ fromLocal: 'dusk', toLocal: '06:08' }),
      seg({ fromLocal: '06:08', toLocal: '24:00' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fromMin).toBe(368);
  });

  it('is empty (not a crash) when the engine returned no segments', () => {
    expect(ribbonRows(undefined)).toEqual([]);
  });
});

describe('deferredShowText (D3 — pinned copy)', () => {
  it('says DEFERRED, never cancelled', () => {
    expect(deferredShowText({ cueId: 'c_show', label: 'Burn Night', dueAtLocal: '20:30' }))
      .toBe('Show due: Burn Night — starts when you exit');
  });

  it('falls back to the cue id when the engine sent no label', () => {
    expect(deferredShowText({ cueId: 'c_show', label: '', dueAtLocal: null }))
      .toBe('Show due: c_show — starts when you exit');
  });

  it('is null when nothing is deferred', () => {
    expect(deferredShowText(null)).toBeNull();
    expect(deferredShowText(undefined)).toBeNull();
  });
});

describe('zoomBannerModel', () => {
  it('renders nothing when no zoom is held', () => {
    expect(zoomBannerModel(null)).toBeNull();
    // A pre-zoom engine omits the key entirely — treated exactly like null, and
    // NEVER as an invented zoom.
    expect(zoomBannerModel(undefined)).toBeNull();
  });

  it('PERFORM is green-toned, names the event, and offers NO steppers', () => {
    const m = zoomBannerModel({
      scope: 'perform', cueId: 'c_party_start', label: 'Party night',
      targetMs: null, targetLocal: null, targetDate: null, pendingDeferred: null,
    })!;
    expect(m.tone).toBe('perform');
    expect(m.title).toBe('PERFORMING');
    expect(m.detail).toContain('Party night');
    expect(m.detail).toContain('the plan is holding');
    // D4: the steppers are a TIME-TRAVEL affordance. A performer stepping
    // "next event" would be a second, undesigned way to move the live rig.
    expect(m.showSteppers).toBe(false);
  });

  it('TRAVEL says plainly it is the PLAN, not tonight, and offers steppers', () => {
    const m = zoomBannerModel({
      scope: 'travel', cueId: 'c_party_start', label: 'Party night',
      targetMs: 1756605600000, targetLocal: '21:00', targetDate: '2026-09-03',
      pendingDeferred: null,
    })!;
    expect(m.tone).toBe('travel');
    expect(m.title).toBe('TIME TRAVELING');
    expect(m.detail).toContain('2026-09-03');
    expect(m.detail).toContain('21:00');
    expect(m.detail).toContain('viewing the plan, not tonight');
    expect(m.showSteppers).toBe(true);
  });

  it('carries the deferred-show line in EITHER scope', () => {
    const deferred = { cueId: 'c_show', label: 'Burn Night', dueAtLocal: '20:30' };
    const perform = zoomBannerModel({
      scope: 'perform', cueId: 'c_x', label: 'X',
      targetMs: null, targetLocal: null, targetDate: null, pendingDeferred: deferred,
    })!;
    const travel = zoomBannerModel({
      scope: 'travel', cueId: null, label: null,
      targetMs: 1, targetLocal: '21:00', targetDate: '2026-09-03', pendingDeferred: deferred,
    })!;
    expect(perform.deferredText).toBe('Show due: Burn Night — starts when you exit');
    expect(travel.deferredText).toBe('Show due: Burn Night — starts when you exit');
  });
});

describe('shouldAnnounceZoomEnd', () => {
  it('announces only an exit this client did NOT ask for', () => {
    // Lease expiry / engine restart / autopilot OFF / maker auto-save.
    expect(shouldAnnounceZoomEnd({ ours: false, entered: true })).toBe(true);
  });

  it('stays SILENT on an operator-requested exit (the live-verified race)', () => {
    // Repro of the bug found on the dist build: the engine broadcasts the
    // cleared zoom on its 1 s tick BEFORE our own resume() response lands, so
    // returning to the TIMELINE tab raised a "zoom ended" alarm at the operator
    // who had just asked to leave. The fix stakes the exit claim before the
    // request goes out — this asserts the resulting decision.
    expect(shouldAnnounceZoomEnd({ ours: true, entered: true })).toBe(false);
  });

  it('stays silent on a pad that never entered the zoom (second-pad case)', () => {
    // Pad B renders the banner off the shared broadcast but must not be yanked
    // anywhere when pad A's performance ends.
    expect(shouldAnnounceZoomEnd({ ours: false, entered: false })).toBe(false);
  });
});

describe('eventZoomMode / canPerform', () => {
  it('offers PERFORM only for the cue the engine says owns the deck', () => {
    expect(eventZoomMode({ cueId: 'c_a', activeCueId: 'c_a' })).toBe('perform');
    expect(eventZoomMode({ cueId: 'c_a', activeCueId: 'c_b' })).toBe('travel');
    expect(eventZoomMode({ cueId: 'c_a', activeCueId: null })).toBe('travel');
    expect(eventZoomMode({ cueId: 'c_a', activeCueId: undefined })).toBe('travel');
  });

  it('refuses PERFORM out of the festival window (takeover would only 400)', () => {
    // _95 §3.7: takeover() refuses to arm out of window. TRAVEL stays available
    // there — that is exactly when the operator rehearses.
    expect(canPerform({ mode: 'perform', planActive: true, inFestivalWindow: true })).toBe(true);
    expect(canPerform({ mode: 'perform', planActive: true, inFestivalWindow: false })).toBe(false);
    expect(canPerform({ mode: 'perform', planActive: false, inFestivalWindow: true })).toBe(false);
    expect(canPerform({ mode: 'travel', planActive: true, inFestivalWindow: true })).toBe(false);
  });
});
