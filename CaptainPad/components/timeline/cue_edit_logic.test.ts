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

import { assembleCue, stripCueSizeGlobal } from './cue_edit_logic';
import type { ActionPlaylist, PlanCue } from '../../utils/timelineApi';

const playlistAction = (over: Partial<ActionPlaylist> = {}): ActionPlaylist => ({
  type: 'playlist',
  name: 'default',
  target: { channel: 'deck', id: null },
  ...over,
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
