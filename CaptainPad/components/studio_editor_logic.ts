// Pure helpers for the STUDIO tab code editor (app/(tabs)/studio.tsx).
//
// Extracted 2026-07-28 as part of the editor fix (report
// .agent/reports/202607/20260725_28_studio_editor_fix.md). Two reasons:
//   1. The tokenizer was duplicated verbatim in two JSX blocks (main-pane
//      preview + modal editor) and re-ran over the WHOLE file on every
//      keystroke. It now runs PER LOGICAL LINE so a memoized line component
//      can skip untouched lines (53-88ms -> sub-frame per keystroke).
//   2. Pure TS = testable under vitest (components/**/*.test.ts).
//
// GEOMETRY CONTRACT (load-bearing — see D2/D3 in the debug report): the
// highlight layer and the transparent <textarea> laid over it must wrap
// IDENTICALLY. Per-line tokenizing must therefore never introduce a per-line
// box: lines are joined back with a literal '\n' inside ONE pre-wrap text
// block, exactly like the original single-block render.
//
// Known tradeoff: a per-line tokenizer cannot color a /* */ comment across
// line boundaries. Accepted (debug report A3) — do NOT reintroduce
// whole-file tokenizing to fix the coloring.

export type HighlightToken = {
  text: string;
  color: string;
  bold: boolean;
};

/** VS Code Dark+ palette used by the studio highlighter. */
export const HIGHLIGHT_COLORS = {
  comment: '#6A9955',
  keyword: '#569CD6',
  number: '#B5CEA8',
  string: '#CE9178',
  punctuation: '#D4D4D4',
  builtin: '#DCDCAA',
  entryPoint: '#4EC9B0',
  identifier: '#9CDCFE',
} as const;

// Same split as the original inline tokenizer. Built fresh per call: a /g
// regex passed to String.split is safe (split clones it), but a shared
// literal invites lastIndex bugs if it is ever used with .test/.exec.
const splitPattern = () =>
  /(\b(?:function|var|let|const|if|else|return|for|while|import|export)\b|\/\*[\s\S]*?\*\/|\/\/.*|'.*?'|".*?"|\b\d+(?:\.\d+)?\b|[{}()\[\]=+\-/*<>!&|]+)/g;

const KEYWORD_RE = /^(?:function|var|let|const|if|else|return|for|while|import|export)$/;
const NUMBER_RE = /^\d+(?:\.\d+)?$/;
const PUNCT_RE = /^[{}()\[\]=+\-/*<>!&|]+$/;
const BUILTIN_RE = /^(?:time|wave|sin|cos|rgb|hsv|rgbwau|triangle|square|max|min|abs|floor|pow|random)\b/;
const ENTRY_RE = /^(?:beforeRender|render3D)\b/;

/** Classify one raw token exactly as the original inline highlighter did. */
export function classifyToken(token: string): { color: string; bold: boolean } {
  if (token.startsWith('//') || token.startsWith('/*')) return { color: HIGHLIGHT_COLORS.comment, bold: false };
  if (KEYWORD_RE.test(token)) return { color: HIGHLIGHT_COLORS.keyword, bold: true };
  if (NUMBER_RE.test(token)) return { color: HIGHLIGHT_COLORS.number, bold: false };
  if (token.startsWith("'") || token.startsWith('"')) return { color: HIGHLIGHT_COLORS.string, bold: false };
  if (PUNCT_RE.test(token)) return { color: HIGHLIGHT_COLORS.punctuation, bold: false };
  if (BUILTIN_RE.test(token)) return { color: HIGHLIGHT_COLORS.builtin, bold: false };
  if (ENTRY_RE.test(token)) return { color: HIGHLIGHT_COLORS.entryPoint, bold: true };
  return { color: HIGHLIGHT_COLORS.identifier, bold: false };
}

/**
 * Tokenize ONE logical line. Never returns a token containing '\n' — the
 * caller owns the line joining so the wrap geometry stays a single pre-wrap
 * block.
 */
export function tokenizeLine(line: string): HighlightToken[] {
  if (line.length === 0) return [];
  const out: HighlightToken[] = [];
  for (const raw of line.split(splitPattern())) {
    if (!raw) continue;
    const { color, bold } = classifyToken(raw);
    out.push({ text: raw, color, bold });
  }
  return out;
}

/**
 * Logical lines AS THE TEXTAREA SEES THEM.
 *
 * A <textarea>'s API value is line-break normalized by the HTML spec: CRLF and
 * lone CR both become LF. Pattern files on this (Windows) box arrive over the
 * engine API with CRLF, so a highlight layer that rendered the raw string
 * carried 312 extra '\r' characters the textarea did not have — the two layers
 * were no longer character-for-character aligned (measured 2026-07-28:
 * highlight 17,564 chars vs textarea 17,252 on 00_golden_hour_wash). Chrome
 * collapses CRLF to a single segment break so the ROW COUNT still matched, but
 * any per-character mapping between the layers was off by one per line.
 *
 * Normalizing here keeps the DISPLAY layer identical to the textarea without
 * touching the `code` state — the bytes that get saved are unchanged.
 */
export function splitLines(code: string): string[] {
  return code.split(/\r\n|\r|\n/);
}

/**
 * Caret-follow scrolling (A5). Given the caret's Y band inside the scroll
 * content and the scroller's current viewport, return the scrollTop that puts
 * the caret back inside the comfortable band, or null when no scroll is
 * needed (caret already visible with margin to spare).
 *
 * Pure so the "does it jitter / does it fight the user" logic is testable
 * without a DOM.
 */
export function caretScrollTarget(o: {
  caretTop: number;
  caretHeight: number;
  scrollTop: number;
  viewportHeight: number;
  margin: number;
  contentHeight?: number;
}): number | null {
  const wantTop = o.caretTop - o.margin;
  const wantBottom = o.caretTop + o.caretHeight + o.margin;
  let next = o.scrollTop;
  if (wantBottom > next + o.viewportHeight) next = wantBottom - o.viewportHeight;
  if (wantTop < next) next = wantTop;
  next = Math.max(0, next);
  if (o.contentHeight != null) {
    next = Math.min(next, Math.max(0, o.contentHeight - o.viewportHeight));
  }
  return Math.abs(next - o.scrollTop) < 1 ? null : next;
}

/** Two spaces — what the Tab key inserts in the editor (A6). */
export const TAB_INSERTION = '  ';
