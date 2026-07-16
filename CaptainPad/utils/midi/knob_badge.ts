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
//     row-major on the 4x4 grid AND offset past row 0's global knobs
//     (`knobIndex + 1 + LOCAL_PARAM_KNOB_OFFSET` → 5..16), so a "KNOB N" badge
//     points the operator at the exact physical encoder.
//   - excludedReason === 'matched' → a CPC owns it; show the existing MATCHED
//     (+ optional CPC label) tag, and the row is dimmed. It consumes NO knob.
//   - excludedReason === 'no-v0'   → not knob-mapped (no numeric v0 anchor);
//     show a subtle not-knob-mapped marker ("—"), dimmed. Consumes NO knob.
//   - excludedReason === 'overflow' → the pattern has more learnable sliders
//     than the 12 physical local-param knobs; same "—" marker, dimmed.

import { LOCAL_PARAM_KNOB_OFFSET, type KnobRow } from './knob_order';

/** The presentation attributes a screen paints for one KnobRow. PURE data. */
export interface KnobBadge {
  /** 1-based PHYSICAL knob number to show ("KNOB 5"), or null when excluded.
   *  Offset past row 0's global knobs — local knobs are 5..16. */
  knobNumber: number | null;
  /** Short badge text next to the slider: "KNOB N" | "MATCHED[ · LABEL]" | "—". */
  text: string;
  /** True when the row is knob-mapped (a physical knob drives it). */
  mapped: boolean;
  /** True when the row should render visually distinct (dimmed) — every
   *  excluded row, never a knob-mapped one. */
  dimmed: boolean;
  /** The excluded reason (null when knob-mapped) — lets a screen pick an icon. */
  excludedReason: 'matched' | 'no-v0' | 'overflow' | null;
}

/** The subset of a CPC-matched export the badge text needs (the friendly CPC
 *  label). Pass `row.export.cpcLabel`. */
export function knobBadgeFor(row: KnobRow): KnobBadge {
  if (row.knobIndex !== null) {
    // 0-based ordered index → 1-based physical knob number, offset past the
    // row-0 global knobs (v2 layout: local param i lives on encoder i+4, i.e.
    // physical knob i+5 counting row-major from the top-left).
    const knobNumber = row.knobIndex + 1 + LOCAL_PARAM_KNOB_OFFSET;
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
  // no-v0 / overflow: not knob-mapped, subtle marker; keep the reason distinct
  // so a screen can explain "no anchor value" vs "ran out of knobs". A row
  // with neither a knobIndex nor a reason violates deriveKnobOrder's contract
  // — fail loud (codex P0), never invent a reason.
  if (row.excludedReason !== 'no-v0' && row.excludedReason !== 'overflow') {
    throw new Error(`knobBadgeFor: excluded row '${row.export.name}' carries no excludedReason`);
  }
  return {
    knobNumber: null,
    text: '—',
    mapped: false,
    dimmed: true,
    excludedReason: row.excludedReason,
  };
}
