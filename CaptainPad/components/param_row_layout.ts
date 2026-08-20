// param_row_layout — the PURE layout contract behind ONE parameter row.
//
// A "parameter row" is the deck/mixer control for a single pattern parameter.
// Since 2026-08-06 (_190) it is exactly TWO visual lines:
//
//   line 1 (the HEADER):  [KNOB N] NAME [status] [♪ SIGNAL] [⊞ MIDI] … [value]
//   line 2:               the slider, full width
//
// Before that the KNOB badge sat on a line of its own, the name/badges wrapped
// unpredictably (the name Text had no `numberOfLines`, so a two-word parameter
// could take two lines), and the author's suggestion note added a fourth line —
// four lines of screen for one slider, on the densest screen in the app.
//
// WHY A PURE MODULE. The CaptainPad vitest env is plain node and excludes
// `.tsx` by design, so a React-Native row can't be render-tested here. Every
// non-trivial decision the row makes therefore lives in this file — which slots
// exist, how wide they are, when the compact variant engages, how a raw export
// name becomes a display name, which ink is readable on a band colour — and the
// components below it only paint the result. Same posture as
// `playlist_row_sizing.ts` and `knob_badge.ts`.
//
// NOTHING here touches parameter names on the wire, knob order, slider
// behaviour, the audioSuggestion metadata contract, modulation semantics or
// MIDI behaviour. It is presentation only.

// ── slots ───────────────────────────────────────────────────────────
//
// The header's slot order is FIXED and shared by every surface, so the deck
// and the mixer physically cannot drift. `status` is whatever small
// control/status indicator the surface already had for that row (the ◎
// modulation pill, MATCHED · <CPC>, the "—" not-knob-mapped marker).

export type ParamRowSlot =
  | 'knob'
  | 'name'
  | 'status'
  | 'suggestion'
  | 'midi'
  | 'note'
  | 'trailing';

/** The canonical left-to-right order. Every surface renders a SUBSET of this,
 *  never a reordering. */
export const PARAM_ROW_SLOT_ORDER: readonly ParamRowSlot[] = [
  'knob', 'name', 'status', 'suggestion', 'midi', 'note', 'trailing',
];

export interface ParamRowContent {
  /** Physical MFT knob number driving this row, or null when none does. */
  knobNumber?: number | null;
  /** The display name — always present; a row without a name is a bug. */
  name: string;
  /** The status indicator's text when the surface renders one: '◎' (the empty
   *  add-hint), '◎ ON' (mapped), 'MATCHED · SIZE', '—'. Null / omitted means the
   *  row shows no status chip. */
  statusLabel?: string | null;
  /** The suggested signal's badge word (e.g. 'FLUX'), or null when the
   *  parameter declares no audioSuggestion. ABSENCE IS ABSENCE — no
   *  placeholder chip is ever rendered for a parameter without one. */
  suggestionLabel?: string | null;
  /** The MIDI chip's text ('⊞' unmapped, '⊞ CC 12' mapped), or null when the
   *  surface hides the chip entirely (read-only + unmapped). */
  midiLabel?: string | null;
  /** The author's short explanation, when the header block carried one. */
  note?: string | null;
  /** The right-aligned readout ('0.35', '65', '0°'), or null. */
  trailing?: string | null;
}

/**
 * Which slots this row actually renders, in canonical order.
 *
 * The point of the function (beyond being testable) is that absence is
 * structural: a parameter with no `audioSuggestion` yields no `suggestion`
 * slot at all — not an empty box holding space in the row.
 */
export function paramRowSlots(content: ParamRowContent, metrics?: ParamRowMetrics): ParamRowSlot[] {
  const out: ParamRowSlot[] = [];
  if (content.knobNumber !== null && content.knobNumber !== undefined) out.push('knob');
  out.push('name');
  if (content.statusLabel) out.push('status');
  if (content.suggestionLabel) out.push('suggestion');
  if (content.midiLabel) out.push('midi');
  // The note only earns a slot on a row wide enough to have slack for it (see
  // `showNote`). Where it doesn't fit it is NOT dropped from the product — it
  // rides the suggestion chip's accessibility hint and the modulation editor's
  // source-chip caption, both of which predate this layout.
  if (content.note && (metrics ? metrics.showNote : false)) out.push('note');
  if (content.trailing) out.push('trailing');
  return out;
}

// ── responsive metrics ──────────────────────────────────────────────
//
// Measured widths of the real surfaces (puppeteer, 2026-08-06, against a fresh
// dist — see report _190):
//
//   deck PARAMETERS column   1194×834 (iPad 11" landscape) → 244 px
//                            1366×1024 (iPad 12.9")        → 295 px
//                            900×700  (narrow tablet)      → 155 px
//   mixer strip LOCAL PARAMS 1194 / 1366                   → 329 px
//                            900                           → 264 px
//
// So the DECK column is the tight case, not the mixer, and 155 px is the
// genuinely narrow one. The compact threshold sits between them.

/** Below this row width the compact variant engages. */
export const PARAM_ROW_COMPACT_WIDTH = 200;

/** At or above this row width there is slack for the author's note. */
export const PARAM_ROW_NOTE_WIDTH = 420;

/** The header NEVER wraps. The name yields (ellipsis) instead — a wrapped
 *  header is the exact regression this module exists to prevent. */
export const PARAM_ROW_FLEX_WRAP = 'nowrap' as const;

/** The name renders on exactly one line. */
export const PARAM_NAME_NUMBER_OF_LINES = 1;

export interface ParamRowMetrics {
  /** The narrow variant: shorter chip labels, tighter spacing, no note. */
  compact: boolean;
  /** Horizontal gap between slots. */
  gap: number;
  /** Chip horizontal padding. */
  chipPadH: number;
  /** Chip box height — one number so every chip in the row shares a baseline. */
  chipHeight: number;
  /** Chip label size. The suggestion chip renders one point larger (it is the
   *  loud one); KNOB / MIDI stay at this size. */
  chipFont: number;
  /** Parameter-name size. */
  nameFont: number;
  /** Floor on the name's width so it never collapses to a bare ellipsis when
   *  the chips are wide. Deliberately SMALLER than a typical short name
   *  ('LEVEL' ≈ 34 px): a floor above that would pad every short name out to a
   *  fixed column and leave a visible gap before the first chip. */
  nameMinWidth: number;
  /** Minimum header height (keeps rows aligned whether or not chips render). */
  rowMinHeight: number;
  /** Whether the author's note rides the header's slack. */
  showNote: boolean;
  /** Whether the live "→0.52" modulation readout fits beside the value. */
  showGhostReadout: boolean;
  /** 'KNOB 7' vs the compact 'K7'. */
  knobLabelShort: boolean;
}

/**
 * Metrics for a row of the given measured width.
 *
 * `availableWidth <= 0` means NOT YET MEASURED (the first paint, before
 * onLayout fires). That resolves to the REGULAR variant deliberately: a row
 * that flashed compact and then expanded would jitter the whole slider stack on
 * every mount, and regular is what every real surface resolves to anyway except
 * the narrow tablet.
 */
export function paramRowMetrics(availableWidth: number): ParamRowMetrics {
  const measured = availableWidth > 0;
  const compact = measured && availableWidth < PARAM_ROW_COMPACT_WIDTH;
  if (compact) {
    return {
      compact: true,
      gap: 3,
      chipPadH: 3,
      chipHeight: 13,
      chipFont: 7,
      nameFont: 9,
      nameMinWidth: 20,
      rowMinHeight: 15,
      showNote: false,
      showGhostReadout: false,
      knobLabelShort: true,
    };
  }
  return {
    compact: false,
    gap: 4,
    chipPadH: 4,
    chipHeight: 16,
    chipFont: 8,
    nameFont: 10,
    nameMinWidth: 28,
    rowMinHeight: 18,
    showNote: measured && availableWidth >= PARAM_ROW_NOTE_WIDTH,
    showGhostReadout: true,
    knobLabelShort: false,
  };
}

/** 'KNOB 7' / 'K7'. The number is the caller's — this only formats it. */
export function knobChipLabel(knobNumber: number, metrics: ParamRowMetrics): string {
  return metrics.knobLabelShort ? `K${knobNumber}` : `KNOB ${knobNumber}`;
}

/** Spoken form for the abbreviated knob chip — a screen reader must never be
 *  left with "K7". */
export function knobChipAccessibilityLabel(knobNumber: number): string {
  return `MIDI knob ${knobNumber}`;
}

/** Spoken form for the ♪ chip. The visible text is the band word alone, so the
 *  label has to carry what the chip MEANS, not just repeat it. */
export function suggestionChipAccessibilityLabel(signalLabel: string, note?: string | null): string {
  const head = `Pattern suggests audio source ${signalLabel}`;
  return note ? `${head} — ${note}` : head;
}

// ── width model ─────────────────────────────────────────────────────
//
// Flexbox does the real layout; this reconstructs it so the "no wrapping, the
// name yields" contract is a TESTED invariant rather than an eyeballed one
// (same role `estimatedRowHeight` plays in playlist_row_sizing.ts).
//
// SpaceGrotesk_700Bold upper-case advance is ~0.62 em; the chip border adds
// 1 px per side.

const CHAR_ADVANCE = 0.62;
const CHIP_BORDER = 2;

/** Rendered width of a chip carrying `label`. */
export function estimatedChipWidth(label: string, metrics: ParamRowMetrics, prominent = false): number {
  const font = prominent ? metrics.chipFont + 1 : metrics.chipFont;
  return Math.round(label.length * font * CHAR_ADVANCE + metrics.chipPadH * 2 + CHIP_BORDER);
}

/** Rendered width of the name at its natural (un-ellipsized) length. */
export function estimatedNameWidth(name: string, metrics: ParamRowMetrics): number {
  return Math.round(name.length * metrics.nameFont * CHAR_ADVANCE);
}

/**
 * How much horizontal room the NAME has left after every fixed slot has taken
 * its full width. The chips never shrink; the name does. A budget at or below
 * `nameMinWidth` means the name will be ellipsized (which is correct and
 * intended) — it never means the row wraps.
 */
export function paramRowNameBudget(
  availableWidth: number,
  metrics: ParamRowMetrics,
  content: ParamRowContent,
): number {
  const slots = paramRowSlots(content, metrics);
  let fixed = 0;
  if (slots.includes('knob')) {
    fixed += estimatedChipWidth(knobChipLabel(content.knobNumber as number, metrics), metrics);
  }
  // The status indicator is a chip of the same family — its width follows
  // whatever the surface actually renders ('◎' add-hint vs '◎ ON' mapped vs
  // 'MATCHED · SIZE'), because assuming the widest form would understate the
  // name's room on the overwhelmingly common unmapped row.
  if (slots.includes('status')) fixed += estimatedChipWidth(content.statusLabel as string, metrics);
  if (slots.includes('suggestion')) {
    fixed += estimatedChipWidth(`♪ ${content.suggestionLabel}`, metrics, true);
  }
  if (slots.includes('midi')) fixed += estimatedChipWidth(content.midiLabel as string, metrics);
  if (slots.includes('trailing')) {
    fixed += Math.round((content.trailing as string).length * (metrics.nameFont + 1) * CHAR_ADVANCE);
  }
  const gaps = Math.max(0, slots.length - 1) * metrics.gap;
  return Math.round(availableWidth - fixed - gaps);
}

/**
 * Does the row fit on ONE line with the name fully readable (not ellipsized)?
 *
 * False is NOT a failure — it is the ellipsis path, which is the designed
 * behaviour for a long name. What would be a failure is wrapping, and that
 * cannot happen: the header sets flexWrap 'nowrap' and the name renders with
 * numberOfLines 1.
 */
export function paramRowNameFits(
  availableWidth: number,
  metrics: ParamRowMetrics,
  content: ParamRowContent,
): boolean {
  return paramRowNameBudget(availableWidth, metrics, content) >= estimatedNameWidth(content.name, metrics);
}

// ── display name ────────────────────────────────────────────────────

/**
 * A pattern export name as the operator should read it:
 * `sliderColorVariation_v2` → `COLOR VARIATION`, `sliderStarCount` → `STAR
 * COUNT`, `sliderColorPalette1` → `COLOR PALETTE 1`.
 *
 * This is the FULL transform, with no length cap — the header renders it on one
 * line and lets the layout ellipsize what doesn't fit, so the visible text is as
 * long as the row can honestly show and the accessible label carries all of it.
 * `prettySliderName` (Modulation.tsx) is this function plus the historical
 * 15-character hard chop, kept byte-identical for the surfaces that still take a
 * fixed-width label (toggle/trigger buttons, the BASE PARAMS strip).
 *
 * The runtime parameter NAME is untouched — this is display only.
 */
export function paramDisplayName(name: string): string {
  return name
    // Optional `_vN` version suffix some patterns put on exports.
    .replace(/_v\d+$/, '')
    .replace(/^(slider|toggle|trigger|hsvPicker)/i, '')
    .replace(/([A-Z])/g, ' $1')
    // Split a trailing index from its word: `colorPalette1` → 'COLOR PALETTE 1'.
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .trim()
    .toUpperCase();
}

/** The historical fixed-width form: the display name, hard-capped at 15 chars. */
export const PARAM_NAME_LEGACY_CAP = 15;

// ── readable ink on a filled chip ───────────────────────────────────
//
// Audio-signal identity colours are FIXED hexes (they mirror the Audio
// Companion, so a band reads the same on the desktop designer and the iPad) and
// therefore cannot be theme tokens. The ♪ chip fills with the band colour, so
// its text colour has to be derived from that fill or it fails contrast on half
// the palette — '#c084fc' violet text on the LIGHT theme's '#f8f9fa' surface is
// ~2.3:1, well under WCAG AA. Picking the better of near-black / white against
// the fill lands every band at ≥ 4.5:1.

const INK_DARK = '#0b0f10';
const INK_LIGHT = '#ffffff';

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`relativeLuminance: expected #rrggbb, got '${hex}'`);
  const n = parseInt(m[1], 16);
  const r = channelLuminance((n >> 16) & 0xff);
  const g = channelLuminance((n >> 8) & 0xff);
  const b = channelLuminance(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The more readable of near-black / white on top of `fill`. */
export function readableInk(fill: string): string {
  return contrastRatio(fill, INK_DARK) >= contrastRatio(fill, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

// ── chip tone ───────────────────────────────────────────────────────
//
// The visual hierarchy the operator reads at a glance:
//
//   loud   — the ♪ audio suggestion: FILLED with the band's identity colour,
//            ink derived for contrast. It is the one chip that says something
//            about the MUSIC.
//   live   — the ◎ modulation / ! OVERRIDE pills: filled green. Unchanged
//            meaning ("the engine is driving this"), now on the shared chip box.
//   quiet  — KNOB N and ⊞ MIDI: outlined, low-alpha wash, accent text. They are
//            reference information (which encoder, which CC), not status, and
//            must not compete with the two above.

export type ParamChipTone = 'loud' | 'live' | 'quiet' | 'ghost';

export interface ParamChipColors {
  background: string;
  border: string;
  text: string;
}

/** Alpha suffixes for an 8-digit hex. Kept as named constants so the quiet /
 *  loud relationship is legible and testable rather than magic. */
const ALPHA_QUIET_FILL = '14';   // 8 %
const ALPHA_QUIET_BORDER = '66'; // 40 %
const ALPHA_LOUD_FILL = 'ff';    // solid

/**
 * Resolve a chip's three colours from its tone and accent.
 *
 * `ghost` is the neutral chip (MATCHED, the "—" not-knob-mapped marker) and is
 * the only tone that needs palette tokens, so it takes them as arguments —
 * keeping this function pure.
 */
export function paramChipColors(
  tone: ParamChipTone,
  accent: string,
  neutral?: { surface: string; border: string; text: string },
): ParamChipColors {
  if (tone === 'loud') {
    return { background: `${accent}${ALPHA_LOUD_FILL}`, border: accent, text: readableInk(accent) };
  }
  if (tone === 'live') {
    return { background: accent, border: accent, text: readableInk(accent) };
  }
  if (tone === 'ghost') {
    if (!neutral) throw new Error('paramChipColors: the ghost tone requires palette colours');
    return { background: neutral.surface, border: neutral.border, text: neutral.text };
  }
  return {
    background: `${accent}${ALPHA_QUIET_FILL}`,
    border: `${accent}${ALPHA_QUIET_BORDER}`,
    text: accent,
  };
}
