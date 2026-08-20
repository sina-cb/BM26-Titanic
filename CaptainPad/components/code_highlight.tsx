import React from 'react';
import { Text } from 'react-native';

import { tokenizeLine, splitLines, type HighlightToken } from './studio_editor_logic';

/**
 * Shared syntax-highlight renderer for the STUDIO tab (main-pane preview AND
 * the modal editor's sub-layer). Replaces the two verbatim-duplicated inline
 * tokenizers.
 *
 * PERFORMANCE (D4): every line is its own React.memo'd component keyed on its
 * text, so a keystroke re-tokenizes and re-reconciles ONLY the edited line
 * instead of ~2,000 spans for the whole file.
 *
 * GEOMETRY (D2/D3): the lines are joined by a literal '\n' inside ONE outer
 * pre-wrap <Text>. There is no per-line box, no margin and no padding, so the
 * soft-wrap result is byte-identical to the old single-block render — which is
 * what lets the transparent <textarea> overlay hit-test the same glyphs. Empty
 * lines get exactly one lineHeight row from the '\n' itself. Do not "improve"
 * this into per-line Views.
 */

type LineProps = {
  text: string;
  newline: boolean;
  lastAndEmpty: boolean;
};

// A textarea always paints an empty final row when the buffer ends with a
// newline; a pre-wrap block does not. Without this zero-width probe the
// textarea is exactly one lineHeight taller than the highlight — i.e. it stays
// internally scrollable by 20px, which is the D3 failure mode in miniature.
const TRAILING_ROW_PROBE = String.fromCharCode(0x200b); // zero-width space

const HighlightLine = React.memo(function HighlightLine({ text, newline, lastAndEmpty }: LineProps) {
  const tokens: HighlightToken[] = tokenizeLine(text);
  return (
    <Text>
      {tokens.map((t, i) => (
        <Text key={i} style={t.bold ? { color: t.color, fontWeight: 'bold' } : { color: t.color }}>
          {t.text}
        </Text>
      ))}
      {lastAndEmpty ? TRAILING_ROW_PROBE : null}
      {newline ? '\n' : null}
    </Text>
  );
});

export type CodeHighlightProps = {
  code: string;
  fontSize: number;
  lineHeight: number;
  padding?: number;
  color?: string;
  fontFamily?: string;
};

export function CodeHighlight({
  code,
  fontSize,
  lineHeight,
  padding = 0,
  color = '#d4d4d4',
  fontFamily = 'Courier',
}: CodeHighlightProps) {
  const lines = splitLines(code);
  return (
    <Text style={{ fontFamily, fontSize, lineHeight, color, padding, margin: 0 }}>
      {lines.map((line, i) => (
        <HighlightLine
          key={i}
          text={line}
          newline={i < lines.length - 1}
          lastAndEmpty={i === lines.length - 1 && line.length === 0}
        />
      ))}
    </Text>
  );
}

export default CodeHighlight;
