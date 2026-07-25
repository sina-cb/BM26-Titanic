// view_selection_picker_logic.ts — RN-free logic for the shared view-selection
// picker (BM readiness W1: surface the engine's `namedViews` auto-view catalog
// on the iPad).
//
// Context (report 20260724_7 §T1): the engine's
// GET /model/view-selection-options returns a `namedViews` array — every mask
// the MaskRegistry interns (base pixel groups + composites + the whole Tier-A
// auto-view catalog: PORT/STARBOARD, WALLS/DECKS/CHIMNEYS, @PAR/@BAR/…,
// BAND_*, `<base>_BOTH` pairs, CTRL_<n>) with its kind + live memberCount.
// CaptainPad previously ignored the field entirely, so ~60 views were
// invisible on the iPad. This module parses that array, classifies each entry
// into an operator-readable family, builds the sectioned/filtered picker
// model, and resolves the viewSelection each entry applies as.
//
// Kept as a PURE .ts module (no react-native imports) so vitest — which loads
// only pure `.ts` logic, never RN `.tsx` — can unit-test the parse,
// classification, sectioning, filtering, and apply-path resolution.

// ── Types ───────────────────────────────────────────────────────────────────

// One entry from GET /model/view-selection-options `namedViews`. `bit` is the
// in-VM viewMask bit (0 for bit-less Tier-A views); `memberCount` is the live
// count of pixels the mask actually covers in the loaded model.
export interface NamedView {
  name: string;
  kind: string; // 'group' | 'composite' | 'pixelSet'
  bit: number;
  memberCount: number;
}

// A per-channel / per-overlay view selection (mirrors the engine's
// viewSelection payload + CaptainPad's ViewSelection interface).
export interface ViewSelectionValue {
  type: string; // 'all' | 'group' | 'viewMask' | 'section' | 'fixture'
  target: string | number | null;
  invert?: boolean;
}

// Display families. Order here is the section render order in the picker.
export type ViewFamilyKey =
  | 'sides'
  | 'structure'
  | 'bands'
  | 'types'
  | 'pairs'
  | 'controllers'
  | 'groups'
  | 'composites'
  | 'other';

export const VIEW_FAMILY_ORDER: ViewFamilyKey[] = [
  'sides',
  'structure',
  'bands',
  'types',
  'pairs',
  'controllers',
  'groups',
  'composites',
  'other',
];

// Operator-facing section titles. Kept short + uppercase for the caps labels.
export const VIEW_FAMILY_TITLES: Record<ViewFamilyKey, string> = {
  sides: 'SIDES & ENDS',
  structure: 'STRUCTURE',
  bands: 'HEIGHT BANDS',
  types: 'FIXTURE TYPES',
  pairs: 'PAIRS (BOTH SIDES)',
  controllers: 'CONTROLLERS',
  groups: 'GROUPS',
  composites: 'COMPOSITES',
  other: 'OTHER VIEWS',
};

// ── Name buckets ─────────────────────────────────────────────────────────────
// The auto-view generator (marsin_engine/lib/auto_views.js) mints these exact
// whole-ship names; PORT/STARBOARD/FORE/AFT + the LED LEFT/RIGHT composites are
// the ship's sides & ends, and WALLS/DECKS/CHIMNEYS/AUDITORIUM its structure.
const SIDE_NAMES = new Set(['PORT', 'STARBOARD', 'FORE', 'AFT', 'LEFT', 'RIGHT', 'BOW', 'STERN']);
const STRUCTURE_NAMES = new Set(['WALLS', 'DECKS', 'CHIMNEYS', 'AUDITORIUM']);

// ── Validation ───────────────────────────────────────────────────────────────

// A well-formed namedViews entry. We drop malformed entries (mirrors the
// engine's own `.filter()` on its viewMasks list) rather than render a row with
// no usable name/target.
export function isValidNamedView(v: unknown): v is NamedView {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    o.name.length > 0 &&
    typeof o.kind === 'string' &&
    Number.isFinite(o.bit as number) &&
    Number.isFinite(o.memberCount as number)
  );
}

// ── Classification ───────────────────────────────────────────────────────────

// Bucket a named view into a display family. Name patterns win over `kind` so
// an auto-view pixelSet like BAND_LOW / @PAR / CTRL_1 lands in its semantic
// family; the remaining group/composite masks fall back on `kind`.
export function classifyNamedView(view: NamedView): ViewFamilyKey {
  const name = view.name;
  if (/^CTRL_/.test(name)) return 'controllers';
  if (name.startsWith('@')) return 'types';
  if (/^BAND_/.test(name)) return 'bands';
  if (/_BOTH$/.test(name)) return 'pairs';
  if (SIDE_NAMES.has(name)) return 'sides';
  if (STRUCTURE_NAMES.has(name)) return 'structure';
  if (view.kind === 'group') return 'groups';
  if (view.kind === 'composite') return 'composites';
  return 'other';
}

// ── Apply-path resolution ────────────────────────────────────────────────────

export const ALL_SELECTION: ViewSelectionValue = { type: 'all', target: null, invert: false };

// The viewSelection a given named view applies as. Base pixel-groups keep the
// historical `type:'group'` apply path (so group selection + snapshot
// serialization behavior is unchanged); every other named view (composite /
// auto-view pixelSet) resolves BY NAME through the engine's viewMask fast path
// (zero-bit Tier-A resolution, marsin_engine/lib/pattern_mixer.js
// compileViewSelectionMask). Unknown names are rejected loudly by the engine.
export function viewSelectionForNamedView(view: NamedView): ViewSelectionValue {
  if (view.kind === 'group') return { type: 'group', target: view.name, invert: false };
  return { type: 'viewMask', target: view.name, invert: false };
}

// Whether the given selection is currently targeting this named view (drives
// the active row highlight). Mirrors viewSelectionForNamedView's type split.
export function isNamedViewActive(
  view: NamedView,
  sel: ViewSelectionValue | null | undefined,
): boolean {
  if (!sel) return false;
  if (view.kind === 'group') return sel.type === 'group' && sel.target === view.name;
  return sel.type === 'viewMask' && sel.target === view.name;
}

// Whether the ALL PIXELS row is the active selection.
export function isAllActive(sel: ViewSelectionValue | null | undefined): boolean {
  return !sel || sel.type === 'all';
}

// ── Section model ────────────────────────────────────────────────────────────

export interface ViewPickerSection {
  key: ViewFamilyKey;
  title: string;
  entries: NamedView[];
}

export interface ViewPickerModel {
  // `namedViews` was absent / not an array in the engine payload — a broken
  // contract. The picker surfaces this loudly (codex P0: fail visible, never
  // silently render an empty/degraded picker as if nothing is wrong).
  missing: boolean;
  sections: ViewPickerSection[];
  // Entry count AFTER the search filter (excludes the synthetic ALL row).
  totalCount: number;
  // Total valid entries BEFORE the search filter — lets the UI tell
  // "model has no views" apart from "your search matched nothing".
  totalUnfiltered: number;
  query: string;
}

// Stable, predictable ordering within a section. HEIGHT BANDS get an explicit
// LOW→MID→HIGH order (alphabetical would read HIGH/LOW/MID); everything else is
// alphabetical.
const BAND_RANK: Record<string, number> = { BAND_LOW: 0, BAND_MID: 1, BAND_HIGH: 2 };

function compareNamedViews(a: NamedView, b: NamedView): number {
  const ra = BAND_RANK[a.name];
  const rb = BAND_RANK[b.name];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  return a.name.localeCompare(b.name);
}

// Build the sectioned, optionally-filtered picker model from the engine's
// namedViews array. `query` is a case-insensitive substring match on the view
// name.
export function buildViewPickerSections(
  namedViews: NamedView[] | null | undefined,
  opts: { query?: string } = {},
): ViewPickerModel {
  const missing = !Array.isArray(namedViews);
  const query = (opts.query || '').trim().toLowerCase();
  const valid = (namedViews || []).filter(isValidNamedView);
  const filtered = query
    ? valid.filter((v) => v.name.toLowerCase().includes(query))
    : valid;

  const buckets = new Map<ViewFamilyKey, NamedView[]>();
  for (const v of filtered) {
    const fam = classifyNamedView(v);
    const list = buckets.get(fam);
    if (list) list.push(v);
    else buckets.set(fam, [v]);
  }

  const sections: ViewPickerSection[] = [];
  for (const key of VIEW_FAMILY_ORDER) {
    const entries = buckets.get(key);
    if (entries && entries.length > 0) {
      entries.sort(compareNamedViews);
      sections.push({ key, title: VIEW_FAMILY_TITLES[key], entries });
    }
  }

  return {
    missing,
    sections,
    totalCount: filtered.length,
    totalUnfiltered: valid.length,
    query,
  };
}

// Short readout for a named view row: "LEFT · 35 px", or "· EMPTY" when the
// mask covers no pixels in the loaded model (a dead view — dimmed by the UI).
export function namedViewMemberLabel(view: NamedView): string {
  if (!Number.isFinite(view.memberCount) || view.memberCount <= 0) return 'EMPTY';
  return `${view.memberCount} px`;
}
