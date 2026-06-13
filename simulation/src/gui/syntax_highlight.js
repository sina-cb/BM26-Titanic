/**
 * syntax_highlight.js — VS Code-style syntax highlighting for the Pattern
 * Editor, ported from the CaptainPad Studio screen so the two editors read
 * identically (Dark+ palette, same tokenizer).
 *
 * Technique: a highlighted <pre> backdrop sits behind a transparent <textarea>
 * (text colour transparent, caret cyan). The textarea stays the real input;
 * the backdrop is purely visual and scroll-synced to it. Both share identical
 * font/metrics/padding (style.css) so glyphs line up exactly.
 */

const KEYWORDS = /^(?:function|var|let|const|if|else|return|for|while|import|export)$/;
const BUILTINS = /^(?:time|wave|sin|cos|rgb|hsv|rgbwau|rgba|triangle|square|max|min|abs|floor|ceil|round|pow|sqrt|random|perlin|clamp|mix|hsv2rgb)\b/;
const SPECIAL = /^(?:beforeRender|render3D|render2D|render)\b/;

// Captures keywords, block/line comments, strings, numbers and operator runs;
// everything else (identifiers, builtins) falls through as plain tokens.
const SPLIT = /(\b(?:function|var|let|const|if|else|return|for|while|import|export)\b|\/\*[\s\S]*?\*\/|\/\/.*|'.*?'|".*?"|\b\d+(?:\.\d+)?\b|[{}()[\]=+\-/*<>!&|%,.;:?]+)/g;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tokenise MarsinScript / Pixelblaze code into highlighted HTML. */
export function highlightCode(code) {
  return code.split(SPLIT).map((tok) => {
    if (!tok) return '';
    const e = esc(tok);
    if (tok.startsWith('//') || tok.startsWith('/*')) return `<span class="pe-tok-comment">${e}</span>`;
    if (KEYWORDS.test(tok)) return `<span class="pe-tok-keyword">${e}</span>`;
    if (/^\d+(?:\.\d+)?$/.test(tok)) return `<span class="pe-tok-number">${e}</span>`;
    if (tok.startsWith("'") || tok.startsWith('"')) return `<span class="pe-tok-string">${e}</span>`;
    if (/^[{}()[\]=+\-/*<>!&|%,.;:?]+$/.test(tok)) return `<span class="pe-tok-op">${e}</span>`;
    if (BUILTINS.test(tok)) return `<span class="pe-tok-builtin">${e}</span>`;
    if (SPECIAL.test(tok)) return `<span class="pe-tok-special">${e}</span>`;
    return `<span class="pe-tok-ident">${e}</span>`;
  }).join('');
}

/**
 * Attach the highlight backdrop to a textarea. Returns a `refresh()` that
 * re-renders the backdrop — call it after any programmatic value change
 * (typing is handled internally via the input event).
 *
 * @param {HTMLTextAreaElement} textarea
 * @returns {() => void}
 */
export function setupSyntaxHighlight(textarea) {
  const wrap = textarea.parentElement;
  if (!wrap || wrap.classList.contains('pe-highlighted')) return () => {};
  wrap.classList.add('pe-highlighted');

  const pre = document.createElement('pre');
  pre.className = 'pe-highlight';
  pre.setAttribute('aria-hidden', 'true');
  const codeEl = document.createElement('code');
  pre.appendChild(codeEl);
  wrap.insertBefore(pre, textarea);

  const refresh = () => {
    // Trailing newline keeps the last line's height when the textarea ends
    // with a newline, so the backdrop and textarea stay the same height.
    codeEl.innerHTML = `${highlightCode(textarea.value)}\n`;
  };
  const syncScroll = () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  };

  textarea.addEventListener('input', refresh);
  textarea.addEventListener('scroll', syncScroll);
  // Expose for the few sites that set textarea.value programmatically.
  textarea.__rehighlight = () => { refresh(); syncScroll(); };

  refresh();
  return refresh;
}
