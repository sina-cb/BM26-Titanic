// knob_page — THE single source of truth for the MFT first page (bank 1) as
// the app UI presents it. The hardware layout itself is data in
// midi_profiles/mft.yaml (context-free, so deck and mixer share one map by
// construction); this module is the matching ON-SCREEN model. The row-0
// global knob numbers feed the "KNOB N" badges the CANONICAL controls wear
// (CPCControls' SPEED fader; the deck's DeckHueRow + the mixer focused
// strip's per-channel HUE trim — knob 2 always drives the FOCUSED channel's
// hue: the deck channel on the deck tab, the focused overlay on the mixer
// tab) via `globalKnobNumber` — one fact base, zero per-surface copies. (The
// old read-only MftGlobalsRow legend was removed 2026-07: no duplicate
// speed/hue UI; the existing elements carry the badges. The GLOBAL hue
// shifter was removed 2026-07 — hue is per-channel only.)
//
//   Row 0 (encoders 0-3)  — GLOBALS: knob 1 SPEED (push = BPM→Speed sync,
//                           green while synced, red at rest), knob 2 HUE
//                           (colour tracks the hue, push = reset; always the
//                           FOCUSED channel's per-channel hue — deck channel
//                           on the deck tab, focused overlay on the mixer
//                           tab), knobs 3-4 unassigned (dim blue).
//   Rows 1-3 (enc 4-15)   — the focused channel's 12 local params, derived by
//                           knob_order.deriveKnobOrder (already the shared
//                           local-knob source for the runtime + both tabs).
//
// Pure data + pure functions — unit-tested (knob_page.test.ts pins this model
// against the SHIPPED mft.yaml so the on-screen legend can never drift from
// the hardware mapping).

import { deriveKnobOrder, Export, KnobOrder } from './knob_order';

/** What a row-0 global knob is assigned to. */
export type GlobalKnobAssignment = 'speed' | 'hue' | 'unassigned';

export interface GlobalKnobSlot {
  /** Physical encoder index (0-based, row-major from the top-left). */
  encoder: number;
  /** 1-based physical knob number the operator counts ("KNOB 1"). */
  knobNumber: number;
  assignment: GlobalKnobAssignment;
  /** Operator-facing label for the on-screen legend. */
  label: string;
}

/** The fixed row-0 global slots of the v2 layout — mirrors mft.yaml. */
export const KNOB_PAGE_GLOBALS: readonly GlobalKnobSlot[] = [
  { encoder: 0, knobNumber: 1, assignment: 'speed', label: 'SPEED' },
  { encoder: 1, knobNumber: 2, assignment: 'hue', label: 'HUE' },
  { encoder: 2, knobNumber: 3, assignment: 'unassigned', label: '—' },
  { encoder: 3, knobNumber: 4, assignment: 'unassigned', label: '—' },
];

/** The physical knob NUMBER for a row-0 global assignment — the one lookup
 *  the on-screen "KNOB N" badges use (CPCControls' SPEED fader, the hue
 *  controls), so a layout change here re-labels every badge. FAILS LOUD on an
 *  assignment the layout doesn't carry (codex P0 — never guess a knob). */
export function globalKnobNumber(assignment: 'speed' | 'hue'): number {
  const slot = KNOB_PAGE_GLOBALS.find((s) => s.assignment === assignment);
  if (!slot) throw new Error(`globalKnobNumber: no row-0 slot is assigned to '${assignment}'`);
  return slot.knobNumber;
}

/** The whole first page: the fixed globals row + the focused channel's local
 *  knob order. */
export interface KnobPage {
  globals: readonly GlobalKnobSlot[];
  locals: KnobOrder;
}

/** Derive the first-page model for a focused channel's exports. PURE — the
 *  live values (speed, sync state, hue degrees, export v0s) stay with the
 *  callers; this is the LAYOUT fact base. */
export function deriveKnobPage(exports: readonly Export[] | undefined | null): KnobPage {
  return { globals: KNOB_PAGE_GLOBALS, locals: deriveKnobOrder(exports) };
}
