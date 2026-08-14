// knob_order — THE single source of truth for the MFT bank-1 knob → local-param
// mapping. The MFT drives the focused pattern's learnable sliders BY ORDER
// (v2 layout: rows 1-3, encoders 4-15 → 12 slots): the local-param knob at
// ordered index i drives `knobMapped[i]`, and physical encoder e = i +
// LOCAL_PARAM_KNOB_OFFSET. Both the hook (which builds `focused.exports` for
// the runtime) and the screens (which paint the "knob N" badge next to each
// on-screen slider) MUST derive that order from HERE so the on-screen order is
// provably identical to the physical knob order rather than two hand-filters
// that can silently drift apart.
//
// A kind-1 export is knob-mapped iff it is a slider (`kind === 1`), NOT
// CPC-matched (`cpcOwned` — the CPC would clobber any static write), and carries
// a numeric `v0` (a fabricated 0.5 base would corrupt soft-takeover pickup math;
// per D5 the engine now always serializes a real v0 for local-control kinds, so
// this guard is belt-and-braces, but we keep it — fail visible, never fabricate).
//
// Pure function, fully unit-tested. No React, no I/O — and deliberately NO
// import from `@/hooks/useEngineState` (that pulls React-Native code and the
// `@/` alias vitest does not resolve), so the derivation stays runnable in the
// plain-node test env. The shape below is structurally the engine's
// `MixerChannelExport` plus the runtime-only cpc fields; the hook assigns its
// real exports to it by structural typing.

// TYPE-ONLY, RELATIVE import: erased at build time, so it never pulls
// `utils/api.ts` (React-Native/fetch code) into this module's runtime graph and
// the plain-node vitest env stays clean. Relative — vitest resolves no `@/`.
import type { AudioSuggestion } from '../api';

/** A pattern's local export as it arrives from the engine. Structurally a
 *  superset of `MixerChannelExport` (id/name/kind/v0/v1/v2) plus the runtime-only
 *  `cpcOwned` / `cpcLabel` fields the engine attaches when a local param is
 *  claimed by a Camp Param Controller (CPC) — present on the wire but not on the
 *  base telemetry interface. This is the canonical Export shape for the knob
 *  derivation and its consumers (the hook + the screens). */
export interface Export {
  id: number;
  name: string;
  kind: number;
  v0?: number;
  v1?: number;
  v2?: number;
  /** True when a CPC owns this param (a static MIDI write would be clobbered). */
  cpcOwned?: boolean;
  /** Friendly CPC label (for the on-screen "MATCHED · LABEL" badge). */
  cpcLabel?: string;
  /** The pattern author's RECOMMENDED audio binding for this param, from the
   *  source's AUDIO_MODULATION_V1 block. Metadata only — it never affects the
   *  knob derivation, the param's name, or its value. See `AudioSuggestion`. */
  audioSuggestion?: AudioSuggestion;
}

/** MFT UX v2 layout facts — the ONE home of the bank-1 local-param geometry.
 *  Row 0 (encoders 0-3) is globals; rows 1-3 (encoders 4-15) are the 12
 *  local-param knobs: physical encoder `e` drives `knobMapped[e - OFFSET]`. */
export const LOCAL_PARAM_KNOB_COUNT = 12;
/** Encoder index of the FIRST local-param knob (row 1, col 0). Screens show
 *  physical knob numbers as `knobIndex + 1 + LOCAL_PARAM_KNOB_OFFSET`. */
export const LOCAL_PARAM_KNOB_OFFSET = 4;

/** Why a kind-1 export is NOT knob-mapped (so screens can label it distinctly).
 *  - `matched`: CPC-owned — the CPC clobbers any static write, so no knob drives it.
 *  - `no-v0`: missing a numeric v0 — excluded rather than fabricated (pickup math).
 *  - `overflow`: the pattern has more learnable sliders than the 12 physical
 *    local-param knobs — this one simply ran out of hardware. */
export type KnobExcludedReason = 'matched' | 'no-v0' | 'overflow';

/** One kind-1 export in on-screen render order, annotated with the physical knob
 *  that drives it (or why it is excluded). */
export interface KnobRow {
  export: Export;
  /** 0-BASED index into `knobMapped` — the runtime drives `knobMapped[knobIndex]`
   *  from physical encoder `knobIndex + LOCAL_PARAM_KNOB_OFFSET`. null when this
   *  row is excluded. Screens show the PHYSICAL knob number as
   *  `knobIndex + 1 + LOCAL_PARAM_KNOB_OFFSET` (5..16, rows 1-3 of the grid). */
  knobIndex: number | null;
  /** Present iff `knobIndex === null`; why this row is not knob-mapped. */
  excludedReason?: KnobExcludedReason;
}

export interface KnobOrder {
  /** The ordered knob-mapped exports: physical knob i drives `knobMapped[i]`. */
  knobMapped: Export[];
  /** EVERY kind-1 export in on-screen render order, each annotated. The order of
   *  the knob-mapped subset here matches `knobMapped` exactly. */
  rows: KnobRow[];
}

/** Has this export a finite numeric v0? (The pickup/anchor guard.) */
function hasNumericV0(e: Export): boolean {
  return typeof e.v0 === 'number' && Number.isFinite(e.v0);
}

/**
 * Derive the knob order from a pattern's exports. PURE.
 *
 * `knobMapped[i]` is the export the physical MFT bank-1 knob `i` drives (0-based).
 * `rows` is every kind-1 export in the SAME render order the screens use, each
 * annotated with its `knobIndex` (0-based, or null) and — when excluded — the
 * reason. The knob-mapped subset of `rows` (in order) equals `knobMapped`.
 *
 * Exclusion order matters for the annotation: `matched` (cpcOwned) is checked
 * before `no-v0` so a CPC-matched export with no v0 is labelled `matched` (the
 * operator's mental model is "the CPC owns it"), matching the screens' badge.
 */
export function deriveKnobOrder(exports: readonly Export[] | undefined | null): KnobOrder {
  const knobMapped: Export[] = [];
  const rows: KnobRow[] = [];
  for (const e of exports ?? []) {
    if (e.kind !== 1) continue; // only sliders are knob-mapped / knob-labelled
    if (e.cpcOwned) {
      rows.push({ export: e, knobIndex: null, excludedReason: 'matched' });
      continue;
    }
    if (!hasNumericV0(e)) {
      rows.push({ export: e, knobIndex: null, excludedReason: 'no-v0' });
      continue;
    }
    // Only LOCAL_PARAM_KNOB_COUNT physical knobs exist (v2 layout: rows 1-3);
    // learnable sliders beyond that are visible but knob-less (`overflow`),
    // never silently wrapped onto a knob that doesn't exist.
    if (knobMapped.length >= LOCAL_PARAM_KNOB_COUNT) {
      rows.push({ export: e, knobIndex: null, excludedReason: 'overflow' });
      continue;
    }
    const knobIndex = knobMapped.length;
    knobMapped.push(e);
    rows.push({ export: e, knobIndex });
  }
  return { knobMapped, rows };
}
