/**
 * Pinned logic tests for PERFORMANCE MODE (the live-show structural lock).
 *
 * Covers: DEFAULT-OFF, defensive reconcile (WS broadcast / POST echo / REST
 * seed, ignoring malformed + off-type messages), the message-type guard, and
 * the exact label / copy wording the two headers + sheets rely on.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERFORMANCE_MODE,
  reconcilePerformanceMode,
  normalizeDirtyEntries,
  isPerformanceModeMessage,
  performanceModeLabel,
  exitActionLabel,
  exitActionHint,
  performanceExitChoices,
  dirtySummaryText,
  dirtyEntryName,
  dirtyRestoreCaption,
  ENTER_CONFIRM_LABEL,
  ENTER_CONFIRM_MESSAGE,
  subscribePerformanceDialogSummon,
  summonPerformanceDialog,
  performanceSummonOutcome,
  pressAgainToGoLiveLabel,
  exitChoiceControllerHint,
} from './performance_mode_logic';

describe('DEFAULT_PERFORMANCE_MODE', () => {
  it('defaults OFF + clean so the badge never flashes active before the engine answers', () => {
    expect(DEFAULT_PERFORMANCE_MODE).toEqual({
      active: false, enteredAt: null, dirtyCount: 0, dirtyEntries: [],
    });
  });
});

describe('reconcilePerformanceMode', () => {
  const prev = DEFAULT_PERFORMANCE_MODE;

  it('adopts an active broadcast with its enteredAt', () => {
    const msg = { type: 'performanceMode', active: true, enteredAt: '2026-07-13T00:00:00Z' };
    expect(reconcilePerformanceMode(prev, msg)).toEqual({
      active: true, enteredAt: '2026-07-13T00:00:00Z', dirtyCount: 0, dirtyEntries: [],
    });
  });

  it('adopts an inactive broadcast and forces enteredAt to null', () => {
    const active = { active: true, enteredAt: '2026-07-13T00:00:00Z', dirtyCount: 0, dirtyEntries: [] };
    const msg = { type: 'performanceMode', active: false, enteredAt: '2026-07-13T00:00:00Z' };
    expect(reconcilePerformanceMode(active, msg)).toEqual({
      active: false, enteredAt: null, dirtyCount: 0, dirtyEntries: [],
    });
  });

  it('accepts a REST/POST body with no type field', () => {
    expect(reconcilePerformanceMode(prev, { active: true, enteredAt: 'x' }))
      .toEqual({ active: true, enteredAt: 'x', dirtyCount: 0, dirtyEntries: [] });
  });

  it('ignores a message of a different type', () => {
    expect(reconcilePerformanceMode(prev, { type: 'mixer', active: true })).toBe(prev);
  });

  it('keeps the previous state when active is a non-boolean (malformed)', () => {
    const active = { active: true, enteredAt: 'x', dirtyCount: 0, dirtyEntries: [] };
    expect(reconcilePerformanceMode(active, { active: 'yes' as unknown })).toBe(active);
  });

  it('tolerates null / undefined / non-object payloads without throwing', () => {
    expect(reconcilePerformanceMode(prev, null)).toBe(prev);
    expect(reconcilePerformanceMode(prev, undefined)).toBe(prev);
    expect(reconcilePerformanceMode(prev, 42 as unknown)).toBe(prev);
  });

  it('normalizes a malformed enteredAt to null when active', () => {
    expect(reconcilePerformanceMode(prev, { active: true, enteredAt: 123 as unknown }))
      .toEqual({ active: true, enteredAt: null, dirtyCount: 0, dirtyEntries: [] });
  });

  it('adopts the dirty summary from a payload that carries it', () => {
    const msg = {
      type: 'performanceMode', active: true, enteredAt: 'z', dirtyCount: 2,
      dirtyEntries: [
        { playlist: 'main', entryId: 'e1', label: 'Aurora' },
        { playlist: 'main', entryId: 'e2', label: null },
      ],
    };
    expect(reconcilePerformanceMode(prev, msg)).toEqual({
      active: true, enteredAt: 'z', dirtyCount: 2,
      dirtyEntries: [
        { playlist: 'main', entryId: 'e1', label: 'Aurora' },
        { playlist: 'main', entryId: 'e2', label: null },
      ],
    });
  });

  it('preserves the previous dirty summary when the echo omits dirty fields', () => {
    const seeded = {
      active: true, enteredAt: 'z', dirtyCount: 3,
      dirtyEntries: [{ playlist: 'p', entryId: 'e', label: 'X' }],
    };
    // A plain enter-echo with no dirty fields must not clobber the seed.
    const next = reconcilePerformanceMode(seeded, { active: true, enteredAt: 'z' });
    expect(next.dirtyCount).toBe(3);
    expect(next.dirtyEntries).toEqual([{ playlist: 'p', entryId: 'e', label: 'X' }]);
  });
});

describe('normalizeDirtyEntries', () => {
  it('drops malformed rows and coerces a non-string label to null', () => {
    const got = normalizeDirtyEntries([
      { playlist: 'a', entryId: 'e1', label: 'Named' },
      { playlist: 'a', entryId: 'e2' },              // missing label → null
      { playlist: 'a', entryId: 'e3', label: 42 },   // bad label → null
      { playlist: 'a' },                              // no entryId → dropped
      null,                                           // junk → dropped
      'nope',                                         // junk → dropped
    ]);
    expect(got).toEqual([
      { playlist: 'a', entryId: 'e1', label: 'Named' },
      { playlist: 'a', entryId: 'e2', label: null },
      { playlist: 'a', entryId: 'e3', label: null },
    ]);
  });

  it('returns [] for a non-array', () => {
    expect(normalizeDirtyEntries(undefined)).toEqual([]);
    expect(normalizeDirtyEntries({} as unknown)).toEqual([]);
  });
});

describe('isPerformanceModeMessage', () => {
  it('accepts a performanceMode message', () => {
    expect(isPerformanceModeMessage({ type: 'performanceMode', active: true })).toBe(true);
  });
  it('rejects other / malformed messages', () => {
    expect(isPerformanceModeMessage({ type: 'mixer' })).toBe(false);
    expect(isPerformanceModeMessage(null)).toBe(false);
    expect(isPerformanceModeMessage('performanceMode')).toBe(false);
  });
});

describe('label + copy helpers', () => {
  it('idle names the mode you enter; active names the mode you switch back to (EDIT)', () => {
    // Operator ruling 2026-07-13: while a show is live the button turns RED and
    // reads "EDIT" — pressing it is how you get back to edit mode.
    expect(performanceModeLabel(false)).toBe('PERFORMANCE');
    expect(performanceModeLabel(true)).toBe('EDIT');
  });

  it('names the exit actions distinctly', () => {
    expect(exitActionLabel('keep')).toMatch(/keep/i);
    expect(exitActionLabel('keep-save')).toMatch(/save/i);
    expect(exitActionLabel('restore')).toMatch(/restore/i);
    expect(exitActionHint('keep')).toMatch(/persist/i);
    expect(exitActionHint('keep-save')).toMatch(/save/i);
    expect(exitActionHint('restore')).toMatch(/discard/i);
  });

  it('the enter confirm copy says structure locks and tweaks are not saved', () => {
    expect(ENTER_CONFIRM_LABEL).toMatch(/go live/i);
    expect(ENTER_CONFIRM_MESSAGE).toMatch(/lock/i);
    expect(ENTER_CONFIRM_MESSAGE).toMatch(/not be saved/i);
  });
});

describe('performanceExitChoices (dirty-aware exit sheet)', () => {
  it('CLEAN (dirtyCount 0) → the original two choices, keep first + restore last', () => {
    const choices = performanceExitChoices(0);
    expect(choices.map((c) => c.action)).toEqual(['keep', 'restore']);
    expect(choices[0].label).toBe('KEEP LIVE STATE');
    expect(choices[1].tone).toBe('restore');
    // No 'keep-save' offered when nothing was tuned.
    expect(choices.some((c) => c.action === 'keep-save')).toBe(false);
  });

  it('DIRTY (dirtyCount > 0) → save-ask: keep-save, keep-without-saving, restore', () => {
    const choices = performanceExitChoices(4);
    expect(choices.map((c) => c.action)).toEqual(['keep-save', 'keep', 'restore']);
    expect(choices[0].label).toBe('KEEP & SAVE TUNING');
    // The two keeps must be unambiguous — 'keep' reads "WITHOUT SAVING" here.
    expect(choices[1].label).toBe('KEEP WITHOUT SAVING');
    expect(choices[1].label).not.toBe(choices[0].label);
    expect(choices[2].action).toBe('restore');
    expect(choices[2].tone).toBe('restore');
  });
});

describe('dirty summary copy', () => {
  const mk = (id: string, label: string | null) => ({ playlist: 'main', entryId: id, label });

  it('clean session → empty summary (sheet omits the line)', () => {
    expect(dirtySummaryText(0, [])).toBe('');
  });

  it('names a single tuned pattern with singular grammar', () => {
    expect(dirtySummaryText(1, [mk('e1', 'Aurora')])).toBe('Aurora was tuned during this session.');
  });

  it('names up to three tuned patterns', () => {
    const s = dirtySummaryText(3, [mk('e1', 'Aurora'), mk('e2', 'Cylon'), mk('e3', 'Sparkle')]);
    expect(s).toBe('Aurora, Cylon, Sparkle were tuned during this session.');
  });

  it('falls back to a count when more than three were tuned', () => {
    const entries = [mk('e1', 'A'), mk('e2', 'B'), mk('e3', 'C'), mk('e4', 'D')];
    expect(dirtySummaryText(4, entries)).toBe('4 patterns were tuned during this session.');
  });

  it('dirtyEntryName prefers the label, falls back to the entry id', () => {
    expect(dirtyEntryName(mk('e1', 'Aurora'))).toBe('Aurora');
    expect(dirtyEntryName(mk('e9', null))).toBe('e9');
    expect(dirtyEntryName(mk('e9', '  '))).toBe('e9'); // blank label → id
  });

  it('dirtyRestoreCaption names what RESTORE discards (count-aware)', () => {
    expect(dirtyRestoreCaption(0)).toBe('');
    expect(dirtyRestoreCaption(1)).toMatch(/discards .*tweak/i);
    expect(dirtyRestoreCaption(4)).toMatch(/discards all 4 tuned patterns/i);
  });
});

describe('performance-dialog summon bus (APC solo → UI sheet)', () => {
  it('returns false when no dialog UI is mounted (fail-loud seam for the pad)', () => {
    expect(summonPerformanceDialog()).toBe(false);
  });

  it('notifies ONLY the first subscriber (deck + mixer both mount the control)', () => {
    const calls: string[] = [];
    const un1 = subscribePerformanceDialogSummon(() => calls.push('first'));
    const un2 = subscribePerformanceDialogSummon(() => calls.push('second'));
    expect(summonPerformanceDialog()).toBe(true);
    expect(calls).toEqual(['first']); // never both — two sheets would stack
    un1();
    // First unmounted → the second becomes the claimant.
    expect(summonPerformanceDialog()).toBe(true);
    expect(calls).toEqual(['first', 'second']);
    un2();
    expect(summonPerformanceDialog()).toBe(false);
  });

  it('a throwing handler never breaks the summoning MIDI callback', () => {
    const un = subscribePerformanceDialogSummon(() => { throw new Error('boom'); });
    expect(() => summonPerformanceDialog()).not.toThrow();
    expect(summonPerformanceDialog()).toBe(true); // still counted as handled
    un();
  });
});

describe('performanceSummonOutcome (what a SOLO press does)', () => {
  const base = { active: false, enterConfirmOpen: false, exitSheetOpen: false, pending: false };

  it('idle, nothing open → opens the enter-confirm sheet', () => {
    expect(performanceSummonOutcome(base)).toBe('openEnterConfirm');
  });

  it('SECOND press while the enter sheet is open CONFIRMS (GO LIVE)', () => {
    // Operator ruling 2026-07-13 round 2: SOLO, SOLO again → live.
    expect(performanceSummonOutcome({ ...base, enterConfirmOpen: true })).toBe('confirmEnter');
  });

  it('active, nothing open → opens the KEEP/RESTORE exit sheet', () => {
    expect(performanceSummonOutcome({ ...base, active: true })).toBe('openExitSheet');
  });

  it('second press on the EXIT sheet does NOT choose keep or restore — it only closes', () => {
    // One physical button cannot pick between the two exits; the choice is
    // answered on the iPad. Closing is safe + reversible (press to reopen).
    const out = performanceSummonOutcome({ ...base, active: true, exitSheetOpen: true });
    expect(out).toBe('closeExitSheet');
    expect(out).not.toBe('confirmEnter');
  });

  it('a press while an enter/exit POST is pending is ignored', () => {
    expect(performanceSummonOutcome({ ...base, pending: true })).toBe('none');
    expect(performanceSummonOutcome({ ...base, enterConfirmOpen: true, pending: true })).toBe('none');
    expect(performanceSummonOutcome({ ...base, active: true, exitSheetOpen: true, pending: true })).toBe('none');
  });
});

describe('controller-affordance copy (rendered ONLY when a binder is connected)', () => {
  it('the press-again row names the physical button', () => {
    expect(pressAgainToGoLiveLabel('SOLO')).toBe('● PRESS SOLO AGAIN TO GO LIVE');
    expect(pressAgainToGoLiveLabel('solo')).toContain('PRESS SOLO AGAIN');
  });

  it('the exit hint says the button only closes and the choice is on the iPad', () => {
    const hint = exitChoiceControllerHint('SOLO');
    expect(hint).toMatch(/^SOLO closes this sheet/);
    expect(hint).toMatch(/KEEP or RESTORE/);
    expect(hint).toMatch(/iPad/);
  });
});
