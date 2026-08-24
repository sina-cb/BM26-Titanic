/**
 * Pins for the two 2026-08-03 operator rulings on the cue editor:
 *
 *   1. cue-level `size` is REMOVED — accepted when an old plan reads in,
 *      shed on save, never re-emitted (the DECK-level size global is a real
 *      control and out of scope here);
 *   2. HOLD left the cue UI but NOT the engine — an existing cue.hold must
 *      round-trip through an edit byte-identical (the party program's hold is
 *      load-bearing), and a new cue emits no hold at all (engine semantics
 *      for an omitted hold: the program holds until the next program).
 */
import { describe, expect, it } from 'vitest';

import {
  assembleCue,
  DEFAULT_CUE_COLOR_PALETTES,
  DEFAULT_CUE_DURATION_MIN,
  defaultCuePlaylistAction,
  isPartyCueTrigger,
  operatorDayToWireDay,
  partyPlaylistActionForEditor,
  planWithUpsertedCue,
  programCueAutopilotError,
  stripEmptyCuePalette,
  stripCueSizeGlobal,
  wireDayToOperatorDay,
  wireDaysForOperatorDay,
} from './cue_edit_logic';
import type { ActionPlaylist, PlanCue, ShowPlan } from '../../utils/timelineApi';

const playlistAction = (over: Partial<ActionPlaylist> = {}): ActionPlaylist => ({
  type: 'playlist',
  name: 'default',
  target: { channel: 'deck', id: null },
  ...over,
});

describe('new cue defaults', () => {
  it('starts a safe 30-second program with the requested deck behavior', () => {
    expect(DEFAULT_CUE_DURATION_MIN).toBe(0.5);
    expect(defaultCuePlaylistAction()).toEqual({
      type: 'playlist',
      name: 'default',
      target: { channel: 'deck', id: null },
      autopilot: { active: true, delay_s: 30, shuffle: true },
      transition: {
        mode: 'trans_crossfade',
        durationMs: 1000,
        enabled: true,
        shuffle: false,
      },
      colorAutopilot: {
        active: true,
        mode: 'palettes',
        palettes: ['bass_drop', 'cyberpunk', 'phoenix'],
        delay_s: 10,
        shuffle: false,
        transitionMs: 1000,
      },
      globals: { speed: 0.25, bpmSpeedSync: 0 },
      overlays: 'disable',
    });
    expect(DEFAULT_CUE_COLOR_PALETTES).toEqual(['bass_drop', 'cyberpunk', 'phoenix']);
  });

  it('returns fresh nested values so edits cannot corrupt later defaults', () => {
    const first = defaultCuePlaylistAction();
    const second = defaultCuePlaylistAction();
    first.autopilot!.shuffle = false;
    first.colorAutopilot!.active = false;
    expect(second.autopilot?.shuffle).toBe(true);
    expect(second.colorAutopilot?.active).toBe(true);
  });
});

describe('programCueAutopilotError', () => {
  const candidate = (over: Partial<PlanCue> = {}): PlanCue => ({
    id: 'c_new',
    kind: 'program',
    trigger: { type: 'clock', at: '20:00' },
    action: playlistAction(),
    ...over,
  });

  it('blocks a new deck program when pattern autopilot is absent or paused', () => {
    expect(programCueAutopilotError(candidate())).toMatch(/AUTOPILOT PATTERNS ON/);
    expect(programCueAutopilotError(candidate({
      action: playlistAction({ autopilot: { active: false, delay_s: 30, shuffle: true } }),
    }))).toMatch(/does not freeze/);
  });

  it('allows an active program, an ambient cue, or a disabled cue', () => {
    expect(programCueAutopilotError(candidate({
      action: playlistAction({ autopilot: { active: true, delay_s: 30, shuffle: true } }),
    }))).toBeNull();
    expect(programCueAutopilotError(candidate({ kind: 'ambient' }))).toBeNull();
    expect(programCueAutopilotError(candidate({ enabled: false }))).toBeNull();
  });
});

describe('isPartyCueTrigger', () => {
  it('recognizes only the engine-compatible mood transition into party', () => {
    expect(isPartyCueTrigger({
      type: 'mood', from: 'calm', to: 'party', minDwellSec: 30, cooldownSec: 300,
    })).toBe(true);
    expect(isPartyCueTrigger({ type: 'mood', from: 'party', to: 'calm' })).toBe(false);
    expect(isPartyCueTrigger({ type: 'manual' })).toBe(false);
  });
});

describe('partyPlaylistActionForEditor', () => {
  const legacyPartyCue: PlanCue = {
    id: 'c_mood_to_party',
    kind: 'mood',
    trigger: { type: 'mood', from: 'calm', to: 'party' },
    action: { type: 'look', look: 'party_high' },
  };

  it('preserves the playlist and palette resolved by a legacy PARTY look', () => {
    expect(partyPlaylistActionForEditor(legacyPartyCue, {
      party_high: { playlist: 'party_high', palette: 'bass_drop' },
    })).toEqual({
      type: 'playlist',
      name: 'party_high',
      palette: 'bass_drop',
      target: { channel: 'deck', id: null },
    });
  });

  it('fails loudly instead of silently choosing a fallback playlist', () => {
    expect(() => partyPlaylistActionForEditor(legacyPartyCue, {
      party_high: { palette: 'bass_drop' },
    })).toThrow(/without a playlist/);
  });
});

describe('stripCueSizeGlobal', () => {
  it('sheds size and keeps every other global', () => {
    const out = stripCueSizeGlobal(
      playlistAction({ globals: { speed: 0.3, size: 0.7, bpmSpeedSync: 1 } }),
    ) as ActionPlaylist;
    expect(out.globals).toEqual({ speed: 0.3, bpmSpeedSync: 1 });
  });

  it('drops the globals map whole when size was its ONLY key', () => {
    // An empty {} would still read as "this cue sets globals" — it must go.
    const out = stripCueSizeGlobal(playlistAction({ globals: { size: 0.5 } })) as ActionPlaylist;
    expect('globals' in out).toBe(false);
  });

  it('is a no-op without a size key (no gratuitous clone of the map)', () => {
    const withGlobals = playlistAction({ globals: { speed: 0.5, bpmSpeedSync: 0 } });
    expect(stripCueSizeGlobal(withGlobals)).toBe(withGlobals);
    const without = playlistAction();
    expect(stripCueSizeGlobal(without)).toBe(without);
  });

  it('leaves non-playlist actions alone', () => {
    const globalsAction = { type: 'globals' as const, set: { size: 0.5 } };
    // An ActionGlobals `set` is the engine's generic map — NOT the cue-level
    // authoring surface the ruling removed. Hands off.
    expect(stripCueSizeGlobal(globalsAction)).toBe(globalsAction);
  });

  it('does not mutate its input', () => {
    const action = playlistAction({ globals: { speed: 0.3, size: 0.7 } });
    stripCueSizeGlobal(action);
    expect(action.globals).toEqual({ speed: 0.3, size: 0.7 });
  });
});

describe('stripEmptyCuePalette', () => {
  it('omits an empty legacy palette instead of submitting an invalid optional field', () => {
    const action = playlistAction({ palette: '   ' });
    const out = stripEmptyCuePalette(action) as ActionPlaylist;
    expect('palette' in out).toBe(false);
    expect(action.palette).toBe('   ');
  });

  it('preserves a selected palette and leaves non-playlist actions alone', () => {
    const selected = playlistAction({ palette: 'bass_drop' });
    expect(stripEmptyCuePalette(selected)).toBe(selected);
    const globalsAction = { type: 'globals' as const, set: { master: 1 } };
    expect(stripEmptyCuePalette(globalsAction)).toBe(globalsAction);
  });
});

describe('assembleCue — the HOLD round-trip pin', () => {
  const held: PlanCue = {
    id: 'c_party_start',
    label: 'Party night',
    kind: 'program',
    trigger: { type: 'sun', event: 'sunset', offsetMin: 120 },
    action: playlistAction({ name: 'party' }),
    hold: { min: 90 },
    days: 'all',
    durationMin: 60,
  };

  it('re-emits an existing hold UNTOUCHED when the cue is edited for other reasons', () => {
    const out = assembleCue({
      initial: held,
      kind: 'program',
      trigger: held.trigger,
      action: playlistAction({ name: 'party_v2' }), // the actual edit
      days: 'all',
      label: 'Party night',
      durationMin: 60,
    });
    expect(out.hold).toEqual({ min: 90 });
    expect(out.action).toEqual(playlistAction({ name: 'party_v2' }));
  });

  it('also round-trips the until-anchor hold form', () => {
    const untilHold = { until: { sun: 'sunrise' } } as unknown as PlanCue['hold'];
    const out = assembleCue({
      initial: { ...held, hold: untilHold },
      kind: 'program',
      trigger: held.trigger,
      action: held.action,
      days: 'all',
      label: '',
      durationMin: 45,
    });
    expect(out.hold).toBe(untilHold);
  });

  it('emits NO hold for a new cue (engine: holds until the next program)', () => {
    const out = assembleCue({
      initial: null,
      kind: 'program',
      trigger: { type: 'clock', at: '20:00' },
      action: playlistAction(),
      days: [2],
      label: 'Fresh',
      durationMin: 60,
    });
    expect('hold' in out).toBe(false);
  });
});

describe('assembleCue — everything else', () => {
  it('preserves unmanaged fields (enabled, catchUp-style unknowns) across a round-trip', () => {
    const exotic = {
      id: 'c_x',
      trigger: { type: 'manual' as const },
      action: playlistAction(),
      enabled: false,
      catchUp: true, // engine-side field the editor never surfaces
    } as PlanCue;
    const out = assembleCue({
      initial: exotic,
      kind: 'ambient',
      trigger: exotic.trigger,
      action: exotic.action,
      days: 'all',
      label: '',
      durationMin: 30,
    });
    expect(out.enabled).toBe(false);
    expect((out as unknown as { catchUp: boolean }).catchUp).toBe(true);
  });

  it('sheds a loaded legacy size on the way OUT (never re-emitted on save)', () => {
    const legacy: PlanCue = {
      id: 'c_old',
      trigger: { type: 'clock', at: '21:00' },
      action: playlistAction({ globals: { speed: 0.4, size: 0.9, bpmSpeedSync: 0 } }),
      durationMin: 60,
    };
    const out = assembleCue({
      initial: legacy,
      kind: 'program',
      trigger: legacy.trigger,
      action: legacy.action, // as if the operator never touched the card
      days: 'all',
      label: '',
      durationMin: 60,
    });
    expect((out.action as ActionPlaylist).globals).toEqual({ speed: 0.4, bpmSpeedSync: 0 });
  });

  it('sheds an empty legacy palette on the way OUT', () => {
    const legacy: PlanCue = {
      id: 'c_empty_palette',
      trigger: { type: 'manual' },
      action: playlistAction({ palette: '' }),
    };
    const out = assembleCue({
      initial: legacy,
      kind: 'program',
      trigger: legacy.trigger,
      action: legacy.action,
      days: 'all',
      label: '',
      durationMin: 60,
    });
    expect('palette' in (out.action as ActionPlaylist)).toBe(false);
  });

  it('trims the label, dropping an all-whitespace one', () => {
    const base = {
      initial: null,
      kind: 'program' as const,
      trigger: { type: 'clock' as const, at: '20:00' },
      action: playlistAction(),
      days: 'all' as const,
      durationMin: 60,
    };
    expect(assembleCue({ ...base, label: '  Sunset  ' }).label).toBe('Sunset');
    expect('label' in assembleCue({ ...base, label: '   ' })).toBe(false);
  });

  it('always emits the required durationMin and blanks the id for a new cue', () => {
    const out = assembleCue({
      initial: null,
      kind: 'mood',
      trigger: { type: 'manual' },
      action: playlistAction(),
      days: 'all',
      label: 'x',
      durationMin: 15,
    });
    expect(out.durationMin).toBe(15);
    expect(out.id).toBe(''); // parent mints ids
  });
});

describe('6 PM operator-day mapping', () => {
  it('rolls morning clock cues onto the next wire day, leaves evening cues put', () => {
    // 3 AM cue authored on operator day 0 → wire day 1 (festival morning of day 1).
    expect(operatorDayToWireDay(0, '03:00')).toBe(1);
    // 5:59 PM is still the morning half of the operator day → next wire day.
    expect(operatorDayToWireDay(2, '17:59')).toBe(3);
    // 6:00 PM is exactly the operator-day boundary → stays on the same wire day.
    expect(operatorDayToWireDay(2, '18:00')).toBe(2);
    // 11:30 PM stays on the same wire day.
    expect(operatorDayToWireDay(4, '23:30')).toBe(4);
  });

  it('leaves non-clock cues on their operator day (sun/phase/manual)', () => {
    expect(operatorDayToWireDay(3, null)).toBe(3);
    expect(operatorDayToWireDay(3, undefined)).toBe(3);
    expect(operatorDayToWireDay(3, '')).toBe(3);
    // Malformed clock strings are treated as no-anchor rather than crashing.
    expect(operatorDayToWireDay(3, 'nope')).toBe(3);
  });

  it('round-trips deserialization back to the operator day the operator selected', () => {
    // 3 AM stored on wire day 1 belongs to operator day 0's calendar card.
    expect(wireDayToOperatorDay(1, '03:00')).toBe(0);
    expect(wireDayToOperatorDay(3, '17:59')).toBe(2);
    expect(wireDayToOperatorDay(2, '18:00')).toBe(2);
    expect(wireDayToOperatorDay(2, '20:00')).toBe(2);
    expect(wireDayToOperatorDay(0, '03:00')).toBeNull(); // no operator day owns it
  });

  it('flags an overflow when the last operator day rolls past the festival span', () => {
    // Festival with 3 days [0,1,2]: a 9 AM cue on operator day 2 needs wire
    // day 3 which doesn't exist → surface loudly instead of dropping the cue.
    const overflow = wireDaysForOperatorDay(2, '09:00', 3);
    expect(overflow.wireDays).toEqual([]);
    expect(overflow.overflowError).toMatch(/rolls past the last festival day/);
  });

  it('emits the correct wire-day array for a legal morning or evening cue', () => {
    expect(wireDaysForOperatorDay(0, '20:00', 8)).toEqual({
      wireDays: [0],
      overflowError: null,
    });
    expect(wireDaysForOperatorDay(0, '09:00', 8)).toEqual({
      wireDays: [1],
      overflowError: null,
    });
    expect(wireDaysForOperatorDay(4, null, 8)).toEqual({
      wireDays: [4],
      overflowError: null,
    });
  });
});

describe('planWithUpsertedCue — validation candidate', () => {
  const plan: ShowPlan = {
    schemaVersion: 2,
    name: 'test',
    location: { lat: 0, lon: 0, tz: 'UTC' },
    festival: { startDate: '2026-08-30', days: 1 },
    autopilot: { enabled: true, delay_s: 30, shuffle: false },
    phases: {},
    looks: {},
    cues: [
      {
        id: 'c_old',
        trigger: { type: 'manual' as const },
        action: playlistAction(),
      },
    ],
  };

  it('adds a cue to a new plan object without touching the draft', () => {
    const added = {
      id: 'c_new',
      trigger: { type: 'manual' as const },
      action: playlistAction(),
    } as PlanCue;
    const candidate = planWithUpsertedCue(plan, added);

    expect(candidate).not.toBe(plan);
    expect(candidate.cues.map((cue) => cue.id)).toEqual(['c_old', 'c_new']);
    expect(plan.cues.map((cue) => cue.id)).toEqual(['c_old']);
  });

  it('replaces by id and rejects an unminted cue', () => {
    const edited = { ...plan.cues[0], label: 'Edited' } as PlanCue;
    expect(planWithUpsertedCue(plan, edited).cues).toEqual([edited]);
    expect(() => planWithUpsertedCue(plan, { ...edited, id: '' })).toThrow(
      'A cue must have an id before plan validation.',
    );
  });
});
