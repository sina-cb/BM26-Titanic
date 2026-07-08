// knob_badge — PURE presentation mapping for a `KnobRow` (from deriveKnobOrder)
// to the small badge/label attributes the screens paint next to each on-screen
// slider. Kept here (not inline in the .tsx) so the "which physical knob drives
// this slider, and is this row knob-mapped or excluded" logic is unit-testable
// in the plain-node vitest env — the screens are React-Native and can't run in
// that env, so anything non-trivial lives in this pure fn and the .tsx just
// paints its result.
//
// The mapping is intentionally exhaustive over the KnobRow shape:
//   - knobIndex !== null → knob-mapped. The physical knob NUMBER is 1-based
//     (`knobIndex + 1`), so a "KNOB N" badge points the operator at the encoder.
//   - excludedReason === 'matched' → a CPC owns it; show the existing MATCHED
//     (+ optional CPC label) tag, and the row is dimmed. It consumes NO knob.
//   - excludedReason === 'no-v0'   → not knob-mapped (no numeric v0 anchor);
//     show a subtle not-knob-mapped marker ("—"), dimmed. Consumes NO knob.

import type { KnobRow } from './knob_order';

/** The presentation attributes a screen paints for one KnobRow. PURE data. */
export interface KnobBadge {
  /** 1-based physical knob number to show ("KNOB 3"), or null when excluded. */
  knobNumber: number | null;
  /** Short badge text next to the slider: "KNOB N" | "MATCHED[ · LABEL]" | "—". */
  text: string;
  /** True when the row is knob-mapped (a physical knob drives it). */
  mapped: boolean;
  /** True when the row should render visually distinct (dimmed) — every
   *  excluded row, never a knob-mapped one. */
  dimmed: boolean;
  /** The excluded reason (null when knob-mapped) — lets a screen pick an icon. */
  excludedReason: 'matched' | 'no-v0' | null;
}

/** The subset of a CPC-matched export the badge text needs (the friendly CPC
 *  label). Pass `row.export.cpcLabel`. */
export function knobBadgeFor(row: KnobRow): KnobBadge {
  if (row.knobIndex !== null) {
    // 0-based knobIndex → 1-based physical knob number for the operator.
    const knobNumber = row.knobIndex + 1;
    return {
      knobNumber,
      text: `KNOB ${knobNumber}`,
      mapped: true,
      dimmed: false,
      excludedReason: null,
    };
  }
  if (row.excludedReason === 'matched') {
    const cpcLabel = row.export.cpcLabel;
    return {
      knobNumber: null,
      text: cpcLabel ? `MATCHED · ${cpcLabel}` : 'MATCHED',
      mapped: false,
      dimmed: true,
      excludedReason: 'matched',
    };
  }
  // no-v0 (the only remaining exclusion): not knob-mapped, subtle marker.
  return {
    knobNumber: null,
    text: '—',
    mapped: false,
    dimmed: true,
    excludedReason: 'no-v0',
  };
}
