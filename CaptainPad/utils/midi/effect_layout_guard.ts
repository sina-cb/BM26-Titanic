// effect_layout_guard — pure guards over a VSN1 / Global-Effects LAYOUT that
// catch the "two pads drive the same underlying effect" crosstalk class.
//
// WHY THIS EXISTS (the Hi-Hat ↔ Blizzard party bug, 2026-07-11):
//   "Hi-Hat" and "Blizzard" are two PRESETS of the SAME engine effect `sparkle`
//   (marsin_engine/lib/global_effect_library.js — sparkle.presets.blizzard /
//   .hihat). The engine tracks a SINGLETON active flag for sparkle
//   (global_effect_slot_manager.js `_isSlotActive` case 'sparkle' → returns
//   `!!c.sparkle.enabled`, with NO preset check — unlike strobe (which checks
//   `activeStrobePresetId === slot.presetId`), colorWash, and feedbackTrails,
//   which ARE preset-aware). So binding two sparkle presets to two VSN1 pads on
//   the SAME page makes pressing one light BOTH — the crosstalk. Two different
//   presets of ONE singleton effect cannot coexist as independent pads.
//
// A "singleton" effect here = one whose engine active-state is NOT scoped by
// preset. For those, two enabled slots on the same VSN1 page collide. For a
// PRESET-AWARE effect (strobe / colorWash / feedbackTrails), two presets on one
// page are independent and legitimate — in BOTH pad-LED reporting AND RUNTIME.
// (Until 2026-07-13 colorWash was preset-aware only for the pad LED; its runtime
// still shared ONE wash layer, so Ocean Wash + Emergency Red replaced each other
// even though the pads looked independent. The engine's colorWash is now keyed
// per slot — see global_effects_controller.js `colorWashes` Map — so two washes
// genuinely coexist. e.g. summer_camp_dome page 0 runs feedbackTrails/
// soft_afterimage AND feedbackTrails/long_afterimage — fine.)
//
// PRESET_AWARE_EFFECT_IDS is a DOCUMENTED MIRROR of the engine's `_isSlotActive`
// preset-scoped cases. It is the ONE place the CaptainPad side encodes that
// engine fact. When the engine effects agent makes `sparkle` preset-aware (the
// directive'd fix — mirror strobe:888), add 'sparkle' here and the guard stops
// flagging sparkle dupes automatically. The accompanying test scans the engine
// source and LOUDLY WARNS if this mirror drifts from `_isSlotActive`, so the
// coupling is self-checking without ever hard-failing the suite on an engine
// rewrite (party-safety: the baseline must stay green).

/** Effects whose engine active-state IS scoped by preset (safe to place two
 *  presets of on one page). Mirror of global_effect_slot_manager.js
 *  `_isSlotActive` — the cases that compare `slot.presetId` / `config.preset`.
 *  Everything NOT in this set is treated as a SINGLETON (dupes on a page = a
 *  crosstalk collision). Sparkle is deliberately ABSENT until the engine fix
 *  makes it preset-aware. */
export const PRESET_AWARE_EFFECT_IDS: ReadonlySet<string> = new Set<string>([
  // Original preset-scoped effects:
  'strobe',         // c.strobeActive && c.activeStrobePresetId === slot.presetId
  'colorWash',      // c.colorWashes.get(`slot:${slotId}`).preset === slot.presetId
  'feedbackTrails', // c.feedbackTrailsConfig.preset === slot.presetId
  // Made preset-aware by the Hi-Hat↔Blizzard RCA fix (engine, 2026-07-11): these
  // singleton effects now stamp the running preset id, so two slots on different
  // presets no longer both report active. `sparkle` was the actual party bug
  // (Hi-Hat + Blizzard). Kept in sync with _isSlotActive by the test's mirror
  // self-check, and the layout scan derives the live set from engine source.
  'beatPump',       // c.beatPump.presetId === slot.presetId
  'waterlineSweep', // c.sweep.presetId === slot.presetId
  'kickPunch',      // c.kickRouter.presetId === slot.presetId
  'freeze',         // c.freeze.presetId === slot.presetId
  'crush',          // c.crush.presetId === slot.presetId
  'breath',         // c.breath.presetId === slot.presetId
  'sparkle',        // c.sparkle.presetId === slot.presetId  ← the fixed party bug
  // Remaining SINGLETONS (NOT preset-aware — a dupe on one page still collides):
  //   dropHit (trigger), invert, vintageWhite, blastWhite, uvBlast, fogger.
]);

/** Engine SLOTS_PER_PAGE (global_effect_slot_manager.js SLOTS_PER_PAGE = 8).
 *  A flat slotId 1..32 lives on page floor((slotId-1)/8). */
export const SLOTS_PER_PAGE = 8;

/** A layout slot, in the shape BOTH the engine state YAML
 *  (states/<scene>/global_effect_slots.yaml — slotId only) and the device
 *  config JSON (vsn1_layout.json — slotId + explicit page) provide. `page` is
 *  optional; when absent it is derived from slotId. */
export interface LayoutSlot {
  slotId: number;
  page?: number;
  effectId?: string | null;
  presetId?: string | null;
  enabled?: boolean;
}

/** A same-page singleton collision: two+ enabled slots on `page` bind the same
 *  non-preset-aware `effectId`, so pressing one drives the other's pad too. */
export interface SinglePageCollision {
  page: number;
  effectId: string;
  slotIds: number[];
  presetIds: (string | null)[];
}

/** The page a flat slotId belongs to. Mirrors engine pageOfSlot. */
export function pageOfSlot(slotId: number, slotsPerPage: number = SLOTS_PER_PAGE): number {
  return Math.floor((slotId - 1) / slotsPerPage);
}

/**
 * Find every same-page SINGLETON collision in a layout.
 *
 * A slot participates when it is ENABLED (enabled !== false) and carries a
 * non-empty effectId. Slots are grouped by page (explicit `page`, else derived
 * from slotId), then by effectId. An effectId NOT in `presetAware` that appears
 * on 2+ slots of one page is a collision — that is the Hi-Hat/Blizzard class.
 *
 * Pure: no I/O. The caller supplies the layout AND the preset-aware set (which
 * mirrors the engine), so the rule is unit-testable with synthetic layouts and
 * auto-tracks the engine when the mirror is updated.
 */
export function findSamePageSingletonCollisions(
  slots: readonly LayoutSlot[],
  presetAware: ReadonlySet<string> = PRESET_AWARE_EFFECT_IDS,
  slotsPerPage: number = SLOTS_PER_PAGE,
): SinglePageCollision[] {
  // page → effectId → slots binding it
  const byPage = new Map<number, Map<string, LayoutSlot[]>>();
  for (const slot of slots) {
    if (slot.enabled === false) continue;              // a disabled slot drives nothing
    const effectId = slot.effectId;
    if (!effectId) continue;                            // empty slot — no binding
    if (!Number.isInteger(slot.slotId)) continue;       // malformed — skip (scan reports separately)
    const page = Number.isInteger(slot.page) ? (slot.page as number) : pageOfSlot(slot.slotId, slotsPerPage);
    let byEffect = byPage.get(page);
    if (!byEffect) { byEffect = new Map(); byPage.set(page, byEffect); }
    const bucket = byEffect.get(effectId);
    if (bucket) bucket.push(slot);
    else byEffect.set(effectId, [slot]);
  }

  const collisions: SinglePageCollision[] = [];
  // Deterministic order (page asc, then effectId) so test output + reports are stable.
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const byEffect = byPage.get(page)!;
    for (const effectId of [...byEffect.keys()].sort()) {
      if (presetAware.has(effectId)) continue;          // preset-scoped → independent pads, fine
      const bound = byEffect.get(effectId)!;
      if (bound.length < 2) continue;                   // single pad — no collision
      collisions.push({
        page,
        effectId,
        slotIds: bound.map((s) => s.slotId),
        presetIds: bound.map((s) => s.presetId ?? null),
      });
    }
  }
  return collisions;
}

/** Human-readable one-liner for a collision (for test failure messages + logs). */
export function describeCollision(c: SinglePageCollision): string {
  const pairs = c.slotIds.map((id, i) => `slot ${id} (${c.presetIds[i] ?? '—'})`).join(' + ');
  return `page ${c.page}: singleton effect '${c.effectId}' bound to ${pairs} — pressing one drives the other`;
}
