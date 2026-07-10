/**
 * Pure, testable derivations for GlobalEffectMacros (the global-effects strip).
 *
 * Extracted from GlobalEffectMacros.tsx so the slot bound/empty + page-window
 * logic can be unit-tested without pulling in react-native (mirrors the
 * deck_tx_logic.ts split). Sina's standing rule: the connections must be
 * asserted by tests — these functions are the ones the "can't remove/change an
 * effect" bug lived in.
 *
 * THE BUG (Sina, live iPad): removing or changing an effect in CaptainPad did
 * nothing visible. Root cause: the REMOVE action PATCHes `{ enabled:false }`,
 * and the engine's clear KEEPS the slot's `effectId` (it only flips `enabled`
 * — see global_effect_slot_manager.patchSlot). The strip decided bound-vs-empty
 * on `effectId` ALONE, so a cleared slot kept rendering its old effect forever.
 * `slotIsBound` is the fix: a slot is bound iff it is BOTH enabled AND carries
 * an effectId. Every surface (grid cells, page-activity dots, swap sheet) shares
 * this one predicate so they can never disagree.
 */

/** The visible-slot window size + page geometry (mirrors the engine's paging:
 *  page p views flat slot ids `8p+1 .. 8p+8`). */
export const VISIBLE_SLOT_COUNT = 8;
export const EFFECTS_PAGE_COUNT = 4;

/** Flat slot id (1..32) for the `index0`-th visible cell on `page`. */
export const slotIdForPage = (page: number, index0: number): number =>
  page * VISIBLE_SLOT_COUNT + index0 + 1;

/** Minimal shape the bound/empty decision needs. */
export interface SlotBindingLike {
  slotId?: number;
  effectId?: string;
  enabled?: boolean;
  active?: boolean;
}

/**
 * Is a slot BOUND (renders as a live effect chip) or EMPTY (renders the "+"
 * socket)? Bound iff enabled AND effectId present. A disabled slot is empty
 * regardless of the stale effectId the engine still reports after a clear —
 * this is the "can't remove an effect" fix.
 */
export function slotIsBound(slot: SlotBindingLike | null | undefined): boolean {
  return !!slot && slot.enabled !== false && !!slot.effectId;
}

/**
 * Build the VISIBLE_SLOT_COUNT cells for `page` from the full engine slot array.
 * A bound slot on the page passes through; an empty/disabled/absent slot becomes
 * an empty stencil carrying the flat slotId (so a PATCH can fill it). Pure and
 * total — always returns exactly VISIBLE_SLOT_COUNT cells.
 */
export function computeVisibleSlots<T extends SlotBindingLike>(
  slots: T[],
  page: number,
  emptyStencil: (slotId: number) => T,
): T[] {
  const realById = new Map<number, T>();
  for (const s of slots) {
    if (typeof s.slotId === 'number') realById.set(s.slotId, s);
  }
  const out: T[] = [];
  for (let i = 0; i < VISIBLE_SLOT_COUNT; i += 1) {
    const slotId = slotIdForPage(page, i);
    const real = realById.get(slotId);
    out.push(slotIsBound(real) ? (real as T) : emptyStencil(slotId));
  }
  return out;
}

/** Which pages (0..EFFECTS_PAGE_COUNT-1) have at least one BOUND + ACTIVE slot
 *  — the page-switcher activity dots. A disabled slot never counts (it's empty),
 *  so a cleared-but-was-active slot correctly drops its page's dot. */
export function computePageActivity(slots: SlotBindingLike[]): boolean[] {
  const arr = Array.from({ length: EFFECTS_PAGE_COUNT }, () => false);
  for (const s of slots) {
    if (typeof s.slotId !== 'number' || !slotIsBound(s) || !s.active) continue;
    const p = Math.floor((s.slotId - 1) / VISIBLE_SLOT_COUNT);
    if (p >= 0 && p < EFFECTS_PAGE_COUNT) arr[p] = true;
  }
  return arr;
}
