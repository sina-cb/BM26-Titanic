import { describe, it, expect } from 'vitest';

import {
  tokenizeLine,
  classifyToken,
  splitLines,
  caretScrollTarget,
  HIGHLIGHT_COLORS,
  TAB_INSERTION,
} from './studio_editor_logic';

describe('classifyToken — same rules the inline highlighter used', () => {
  it('colors comments, keywords, numbers, strings, punctuation', () => {
    expect(classifyToken('// hi').color).toBe(HIGHLIGHT_COLORS.comment);
    expect(classifyToken('/* hi */').color).toBe(HIGHLIGHT_COLORS.comment);
    expect(classifyToken('function')).toEqual({ color: HIGHLIGHT_COLORS.keyword, bold: true });
    expect(classifyToken('3.14').color).toBe(HIGHLIGHT_COLORS.number);
    expect(classifyToken("'abc'").color).toBe(HIGHLIGHT_COLORS.string);
    expect(classifyToken('"abc"').color).toBe(HIGHLIGHT_COLORS.string);
    expect(classifyToken('{(=').color).toBe(HIGHLIGHT_COLORS.punctuation);
  });
  it('colors engine builtins and entry points', () => {
    expect(classifyToken('rgbwau').color).toBe(HIGHLIGHT_COLORS.builtin);
    expect(classifyToken('wave').color).toBe(HIGHLIGHT_COLORS.builtin);
    expect(classifyToken('render3D')).toEqual({ color: HIGHLIGHT_COLORS.entryPoint, bold: true });
    expect(classifyToken('beforeRender').bold).toBe(true);
  });
  it('falls through to identifier color', () => {
    expect(classifyToken('myVariable').color).toBe(HIGHLIGHT_COLORS.identifier);
  });
});

describe('tokenizeLine — GEOMETRY CONTRACT: lossless, never emits a newline', () => {
  const lines = [
    'export function render3D(index, x, y, z) {',
    '  var h = wave(time(0.1) + x * 3.5);   // drift',
    "  var name = 'golden hour';",
    '',
    '}',
    '   ',
    'a+b-c/d*e<f>g!h&i|j[k]{l}(m)=n',
  ];
  it('concatenated token text reproduces the line byte-for-byte', () => {
    for (const line of lines) {
      const joined = tokenizeLine(line).map((t) => t.text).join('');
      expect(joined).toBe(line);
    }
  });
  it('never produces a token containing a newline', () => {
    for (const line of lines) {
      for (const t of tokenizeLine(line)) expect(t.text.includes('\n')).toBe(false);
    }
  });
  it('empty line yields no tokens (caller supplies the 1-row height)', () => {
    expect(tokenizeLine('')).toEqual([]);
  });
  it('is stateless across repeated calls (no /g lastIndex leak)', () => {
    const first = tokenizeLine(lines[1]);
    for (let i = 0; i < 5; i++) expect(tokenizeLine(lines[1])).toEqual(first);
  });
});

describe('splitLines', () => {
  it('keeps every logical line including trailing and interior blanks', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b', '']);
    expect(splitLines('')).toEqual(['']);
  });
  it('rejoining with \\n is lossless (wrap geometry stays one pre-wrap block)', () => {
    const code = 'var a = 1;\n\n  // x\nrender3D();\n';
    expect(splitLines(code).join('\n')).toBe(code);
  });
  it('normalizes CRLF and lone CR exactly like a <textarea> value does', () => {
    // Pattern files arrive CRLF from the engine on Windows; the textarea's
    // .value strips the CR, so the highlight layer must too or the two layers
    // are off by one character per line.
    expect(splitLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\rb')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb').join('\n')).toBe('a\nb');
    expect(splitLines('a\r\n\r\nb').length).toBe(3);
  });
});

describe('caretScrollTarget — A5 caret follow', () => {
  const base = { caretHeight: 20, viewportHeight: 400, margin: 60 };
  it('returns null when the caret is comfortably visible', () => {
    expect(caretScrollTarget({ ...base, caretTop: 200, scrollTop: 0 })).toBeNull();
  });
  it('scrolls down just enough when the caret is below the fold', () => {
    expect(caretScrollTarget({ ...base, caretTop: 500, scrollTop: 0 })).toBe(500 + 20 + 60 - 400);
  });
  it('scrolls up when the caret is above the viewport', () => {
    expect(caretScrollTarget({ ...base, caretTop: 100, scrollTop: 300 })).toBe(40);
  });
  it('never scrolls to a negative offset', () => {
    expect(caretScrollTarget({ ...base, caretTop: 0, scrollTop: 30 })).toBe(0);
  });
  it('clamps to the bottom of the content when given contentHeight', () => {
    const y = caretScrollTarget({ ...base, caretTop: 980, scrollTop: 0, contentHeight: 1000 });
    expect(y).toBe(600);
  });
  it('ignores sub-pixel differences so it cannot jitter per keystroke', () => {
    expect(caretScrollTarget({ ...base, caretTop: 460.4, scrollTop: 140.5 })).toBeNull();
  });
});

describe('TAB_INSERTION', () => {
  it('is two spaces', () => expect(TAB_INSERTION).toBe('  '));
});
