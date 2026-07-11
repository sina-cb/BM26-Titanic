/**
 * Pure, testable derivations for the Global-Effects PICKER surfaces.
 *
 * Extracted from GlobalEffectMacros.tsx (the SwapSheet / SLOT n dialog) so the
 * favorites, section-grouping, and encoder-disable rules can be unit-tested
 * WITHOUT pulling in react-native (mirrors the global_effect_macros_logic.ts
 * split). Vitest discovers `components/**\/*.test.ts` — this file's tests live
 * next to it.
 *
 * WHY THIS EXISTS (party 2026-07-11): the operator "lost the strobe" when the
 * engine renamed it, because the UI silently dropped ids it didn't recognise.
 * Every rule here is built from the engine registry (the fetched library) with
 * NO hardcoded id ALLOWLIST that could filter an effect out — everything the
 * engine ships renders, unknown or not (Codex P0: fail loud, never silently
 * drop). The one hardcoded surface below is the operator's party FAVORITES
 * (which presets to STAR) and the display GROUPING (which section header a few
 * families sit under) — both are presentation-only and can never hide an
 * effect: an id we don't special-case simply renders ungrouped under its
 * engine name.
 */

/** Minimal shape of a library PRESET (subset of the engine's describeLibrary). */
export interface PickerPreset {
  id: string;
  label: string;
  defaultBehavior: string;
  [k: string]: unknown;
}

/** Minimal shape of a library EFFECT (subset of the engine's describeLibrary). */
export interface PickerEffect {
  id: string;
  name: string;
  category?: string;
  presets: Record<string, PickerPreset>;
  // Declarative value-encoder opt-out (e.g. fogger → 'none'); optional so a
  // pre-field engine just leaves it undefined (feature-detect below).
  valueParam?: string | null;
  [k: string]: unknown;
}

export type PickerLibrary = Record<string, PickerEffect>;

// ── Party favorites ────────────────────────────────────────────────────────
// The operator's party picks (2026-07-11): the presets STARRED (⭐) everywhere
// a preset is listed — the swap picker, the slot chips, the scheduler picker.
// EASY TO EDIT: this is the ONE place. Add / remove {effectId, presetId} pairs.
//
// `presetId: '*'` matches ANY preset of the effect. Used for `strobe`, whose
// engine preset id is being collapsed from five (pulse_2hz…max_20hz) down to a
// single 'Strobe' — the wildcard keeps it starred no matter which single id
// lands, and keeps the whole strobe family starred while the collapse is still
// in flight (feature-detect: never crashes on the pre/post-rename shape).
export interface FavoriteRef {
  effectId: string;
  /** Exact engine preset id, or '*' to match every preset of the effect. */
  presetId: string;
}

export const PARTY_FAVORITES: readonly FavoriteRef[] = Object.freeze([
  { effectId: 'blastWhite', presetId: 'default' },          // Blast White
  { effectId: 'dropHit', presetId: 'white_drop' },          // White Flash
  { effectId: 'dropHit', presetId: 'iceberg_flash' },       // Iceberg Flash
  { effectId: 'strobe', presetId: '*' },                    // Strobe (collapsed preset — feature-detect)
  { effectId: 'beatPump', presetId: 'soft' },               // Soft Pump
  { effectId: 'feedbackTrails', presetId: 'cosmic_trails' },// Cosmic Trails
  { effectId: 'freeze', presetId: 'hold' },                 // Hold
  { effectId: 'sparkle', presetId: 'fizz' },                // Fizz
]);

/** Is this (effectId, presetId) one of the operator's starred party picks? */
export function isFavoritePreset(effectId: string, presetId: string): boolean {
  return PARTY_FAVORITES.some(
    (f) => f.effectId === effectId && (f.presetId === '*' || f.presetId === presetId),
  );
}

// ── Picker section grouping ─────────────────────────────────────────────────
// Named UI groups that override the engine effect-name headers for a few
// families (operator party layout 2026-07-11). Each group claims one or more
// effectIds; EVERY preset of a claimed effect renders under the group title.
// Effects NOT claimed here render UNGROUPED under their engine name (fx.name) —
// so the engine's Pulse→Strobe rename flows straight through and nothing is
// ever hidden. EASY TO EDIT.
//
// FEATURE-DETECT: an effectId the engine doesn't (yet) ship is simply skipped —
// a group with zero present members is omitted. The color-replace family is
// mid-rename on the engine side (colorWash → color_replace, preset ids
// ocean_blue→oceanBlue / iceberg_cyan→icebergCyan / +purple / emergency_red→
// emergencyRed), so BOTH the old and new effect ids are listed and whichever
// the engine currently reports wins. Because groups claim WHOLE effects, the
// preset-id rename needs no change here.
export interface PickerGroupDef {
  title: string;
  effectIds: readonly string[];
}

export const PICKER_GROUPS: readonly PickerGroupDef[] = Object.freeze([
  { title: 'Blast Effects', effectIds: ['vintageWhite', 'blastWhite'] },
  { title: 'Flashes', effectIds: ['dropHit'] },
  { title: 'Color Replacement', effectIds: ['colorReplace', 'color_replace', 'colorWash'] },
]);

/** One selectable preset row in the picker. */
export interface PickerRow {
  effectId: string;
  presetId: string;
  preset: PickerPreset;
  /** Engine effect display name (fx.name) — used as the ungrouped section header. */
  effectName: string;
  /** Starred party pick. */
  favorite: boolean;
}

/** One section (header + rows) in the picker. */
export interface PickerSection {
  /** Named group title, or the engine effect name for an ungrouped effect. */
  title: string;
  rows: PickerRow[];
}

/**
 * Build the ordered picker sections from the engine library.
 *
 * - NAMED GROUPS first, in PICKER_GROUPS order. A group's rows are the presets
 *   of every claimed effect that the library actually ships (feature-detect);
 *   an empty group is omitted.
 * - Then every REMAINING effect, in library insertion order, as its own section
 *   headed by its engine name (fx.name).
 *
 * NOTHING is filtered: every effect + preset in `library` lands in exactly one
 * section. If a PICKER_GROUPS entry names an effectId the library doesn't ship,
 * we `console.warn` (feature-detect, non-fatal) and skip it. `warn` is injected
 * so tests can assert the loud path without a global spy.
 */
export function buildPickerSections(
  library: PickerLibrary | null | undefined,
  warn: (msg: string) => void = (m) => console.warn(m),
): PickerSection[] {
  if (!library) return [];

  // Which effectId belongs to which named group (first group wins if an id is
  // listed twice — the config is authored not to overlap, but be deterministic).
  const effectToGroup = new Map<string, string>();
  for (const g of PICKER_GROUPS) {
    for (const id of g.effectIds) {
      if (!effectToGroup.has(id)) effectToGroup.set(id, g.title);
    }
  }

  const rowsFor = (fx: PickerEffect): PickerRow[] =>
    Object.entries(fx.presets || {}).map(([pid, preset]) => ({
      effectId: fx.id,
      presetId: pid,
      preset,
      effectName: fx.name,
      favorite: isFavoritePreset(fx.id, pid),
    }));

  const sections: PickerSection[] = [];
  const claimed = new Set<string>();

  // Named groups first, in declared order.
  for (const g of PICKER_GROUPS) {
    const rows: PickerRow[] = [];
    for (const id of g.effectIds) {
      const fx = library[id];
      if (!fx) continue; // feature-detect: engine doesn't ship this id (yet)
      if (claimed.has(id)) continue;
      claimed.add(id);
      rows.push(...rowsFor(fx));
    }
    if (rows.length > 0) sections.push({ title: g.title, rows });
  }

  // Loud, non-fatal warning for a group that claimed NOTHING (every id absent) —
  // a signal the grouping config has drifted from the engine registry.
  for (const g of PICKER_GROUPS) {
    const anyPresent = g.effectIds.some((id) => !!library[id]);
    if (!anyPresent) {
      warn(
        `[effect-picker] group '${g.title}' matched no engine effects ` +
        `(none of ${JSON.stringify(g.effectIds)} in library) — check the grouping config`,
      );
    }
  }

  // Then every remaining effect, ungrouped, in library order.
  for (const fx of Object.values(library)) {
    if (claimed.has(fx.id)) continue;
    sections.push({ title: fx.name, rows: rowsFor(fx) });
  }

  return sections;
}

// ── Encoder-disable (fogger & friends) ──────────────────────────────────────
// A slot whose focused effect has NO magnitude knob must disable the VSN1 value
// encoder / intensity editor — a dead knob on a live show is a trap.
//
// PREFERRED SIGNAL: the engine threads `valueParam` on the slot status
// (global_effect_library.js fogger.valueParam='none'). When it is present it
// WINS: 'none' → disable, anything else → the effect HAS a knob, keep it.
//
// FALLBACK (loudly commented): a UI override table for engines that predate the
// `valueParam` field on slot status. Currently ONLY `fogger`. Remove an id from
// here once the engine reliably reports valueParam for it — do NOT add ids
// speculatively (that would silently kill a real knob).
export const ENCODER_DISABLED_EFFECT_IDS: ReadonlySet<string> = new Set<string>([
  'fogger',
]);

/**
 * Should the value encoder / intensity editor be DISABLED for this slot?
 * `valueParam` from the engine wins when present; otherwise fall back to the
 * hardcoded override table.
 */
export function slotDisablesEncoder(
  slot: { effectId?: string; valueParam?: string | null } | null | undefined,
): boolean {
  if (!slot) return false;
  if (slot.valueParam === 'none') return true;   // engine-declared: no knob
  if (slot.valueParam != null) return false;     // engine says it HAS a knob → trust it
  return !!slot.effectId && ENCODER_DISABLED_EFFECT_IDS.has(slot.effectId); // fallback table
}

/**
 * Resolve a bound slot's effect against the fetched library. Returns whether the
 * effect id is KNOWN (present in the library) plus a display name. Emits a loud,
 * one-shot `console.warn` for an UNKNOWN id — this is the "lost strobe" guard:
 * a slot bound to a renamed/removed effect id must announce itself, never
 * silently misbehave. `warn` is injected for testability.
 */
export function resolveSlotEffectName(
  slot: { effectId?: string; label?: string } | null | undefined,
  library: PickerLibrary | null | undefined,
  warn: (msg: string) => void = (m) => console.warn(m),
): { known: boolean; name: string } {
  const effectId = slot?.effectId || '';
  const fx = library && effectId ? library[effectId] : undefined;
  if (fx) return { known: true, name: fx.name };
  if (effectId && library) {
    // Only warn once the library has actually loaded (library non-null) — before
    // that we genuinely don't know yet.
    warn(
      `[effect-picker] slot bound to unknown effectId '${effectId}' ` +
      `(not in engine library) — rendering a generic card; check for an engine rename`,
    );
  }
  return { known: false, name: slot?.label || effectId || 'Unknown' };
}
