/**
 * Bug #1 — "Can't remove or change an effect in CaptainPad."
 *
 * Root cause (verified against marsin_engine/lib/global_effect_slot_manager.js):
 * the REMOVE action PATCHes `{ enabled:false }`, and the engine's clear KEEPS
 * the slot's `effectId` (it only flips `enabled`). The strip decided
 * bound-vs-empty on `effectId` ALONE, so a cleared slot kept rendering its old
 * effect forever — the operator "couldn't remove" it. These tests pin the
 * enabled+effectId predicate so a disabled slot renders EMPTY and the UI
 * reflects the removal / swap immediately.
 */
import { describe, it, expect } from 'vitest';
import {
  slotIsBound,
  computeVisibleSlots,
  computePageActivity,
  slotIdForPage,
  resolveEffectsPage,
  SHOW_EFFECT_PAGES,
  VISIBLE_SLOT_COUNT,
  SlotBindingLike,
} from './global_effect_macros_logic';

const empty = (slotId: number): SlotBindingLike & { slotId: number } => ({
  slotId, effectId: '', enabled: false, active: false,
});

describe('slotIsBound (the can-not-remove fix)', () => {
  it('a bound slot (enabled + effectId) is bound', () => {
    expect(slotIsBound({ slotId: 1, effectId: 'strobe', enabled: true })).toBe(true);
  });

  it('a CLEARED slot (enabled:false but stale effectId kept by the engine) is EMPTY', () => {
    // This is the exact engine post-clear shape: patchSlot({enabled:false})
    // leaves effectId set. Pre-fix this rendered as bound → "can't remove".
    expect(slotIsBound({ slotId: 1, effectId: 'strobe', enabled: false })).toBe(false);
  });

  it('a truly empty slot (no effectId) is empty', () => {
    expect(slotIsBound({ slotId: 1, effectId: '', enabled: true })).toBe(false);
    expect(slotIsBound({ slotId: 1, enabled: true })).toBe(false);
  });

  it('a slot with effectId but no enabled field (legacy) is bound (enabled defaults truthy)', () => {
    // enabled === undefined must NOT read as disabled — only an explicit false clears.
    expect(slotIsBound({ slotId: 1, effectId: 'strobe' })).toBe(true);
  });

  it('null/undefined is empty', () => {
    expect(slotIsBound(null)).toBe(false);
    expect(slotIsBound(undefined)).toBe(false);
  });
});

describe('computeVisibleSlots — REMOVE reflects to the UI', () => {
  it('a removed effect (enabled:false) shows the empty stencil, not the stale effect', () => {
    // Slot 1 was bound to strobe; the operator hit REMOVE → engine returns it
    // enabled:false with effectId STILL 'strobe'. The cell must render empty.
    const slots: SlotBindingLike[] = [{ slotId: 1, effectId: 'strobe', enabled: false, active: false }];
    const cells = computeVisibleSlots(slots, 0, empty);
    expect(cells).toHaveLength(VISIBLE_SLOT_COUNT);
    expect(slotIsBound(cells[0])).toBe(false);     // slot 1 now EMPTY (removed)
    expect(cells[0].slotId).toBe(1);
  });

  it('a swapped effect (enabled:true, new effectId) reflects the new binding', () => {
    const slots: SlotBindingLike[] = [{ slotId: 1, effectId: 'colorWash', enabled: true, active: false }];
    const cells = computeVisibleSlots(slots, 0, empty);
    expect(slotIsBound(cells[0])).toBe(true);
    expect(cells[0].effectId).toBe('colorWash');
  });

  it('always yields exactly VISIBLE_SLOT_COUNT cells, padding missing slots empty', () => {
    const cells = computeVisibleSlots([], 0, empty);
    expect(cells).toHaveLength(VISIBLE_SLOT_COUNT);
    expect(cells.every((c) => !slotIsBound(c))).toBe(true);
  });
});

describe('computeVisibleSlots — page window', () => {
  it('page p shows flat slot ids 8p+1..8p+8', () => {
    // Bind slot 17 (page 2, key 0). Only page 2 shows it.
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: true, active: true }];
    const p2 = computeVisibleSlots(slots, 2, empty);
    expect(p2[0].slotId).toBe(slotIdForPage(2, 0)); // 17
    expect(slotIsBound(p2[0])).toBe(true);
    // Page 0 does NOT show slot 17.
    const p0 = computeVisibleSlots(slots, 0, empty);
    expect(p0.every((c) => !slotIsBound(c))).toBe(true);
  });
});

describe('resolveEffectsPage — party single-page layout (SHOW_EFFECT_PAGES)', () => {
  it('the party ships with the pager HIDDEN (single-page layout)', () => {
    // Guards the intended shipping state: the 4-page switcher is off because
    // the VSN1 side buttons no longer page. Flipping the flag on is a deliberate
    // choice, and flipping it should light up the switcher tests below.
    expect(SHOW_EFFECT_PAGES).toBe(false);
  });

  it('pins the render page to 0 when the pager is hidden, whatever the engine page', () => {
    // Even a stale/persisted non-zero engine page renders page 0 (the grid shows
    // the party-8 layout). This is the "render page 1 anyway" contract.
    expect(resolveEffectsPage(0, false)).toBe(0);
    expect(resolveEffectsPage(2, false)).toBe(0);
    expect(resolveEffectsPage(3, false)).toBe(0);
  });

  it('honours the engine page verbatim when the pager is shown', () => {
    expect(resolveEffectsPage(0, true)).toBe(0);
    expect(resolveEffectsPage(2, true)).toBe(2);
  });

  it('defaults to the shipping SHOW_EFFECT_PAGES flag when no override is passed', () => {
    // With the flag false, the one-arg form pins page 0 — the grid can never
    // render a non-party page while the switcher is hidden.
    expect(resolveEffectsPage(3)).toBe(SHOW_EFFECT_PAGES ? 3 : 0);
  });
});

describe('computePageActivity — cleared slots drop their dot', () => {
  it('an active bound slot lights its page dot', () => {
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: true, active: true }];
    expect(computePageActivity(slots)).toEqual([false, false, true, false]);
  });

  it('a cleared-but-still-active-flag slot does NOT light its page dot', () => {
    // After a clear the engine may still report active:true briefly with the
    // stale effectId; since it is disabled it must count as empty (no dot).
    const slots: SlotBindingLike[] = [{ slotId: 17, effectId: 'strobe', enabled: false, active: true }];
    expect(computePageActivity(slots)).toEqual([false, false, false, false]);
  });
});
