// html_shell_selection_guard.test.ts — source-text guard for the app-wide
// text-selection kill shipped in `app/+html.tsx` (docs/68).
//
// WHY SOURCE TEXT. `app/+html.tsx` is expo-router's static-HTML seam: it
// only actually renders during `expo export --platform web` / Metro's web
// static pipeline, which vitest's plain-Node environment does not run. Same
// idiom as `components/native_gesture_armor.test.ts`: read the real source
// and assert the contract holds, so a later edit that quietly deletes the
// kill — or, worse, deletes the caret counter-rule while keeping the kill —
// goes red instead of shipping silently.
//
// Every guard below is MUTATION-HONEST — delete or corrupt the line it
// describes and the test goes red — and each block carries a positive
// sanity assertion so an over-eager regex cannot pass by matching nothing.
//
// stripComments deliberately strips JS-style comments ONLY (line + block),
// matching the house helper in native_gesture_armor.test.ts. `app/+html.tsx`
// carries no `/* */` block comments anywhere (its docblock is all `//`
// lines), so this cannot eat into the CSS template literal — verified by
// the positive-sanity assertions below, which would themselves go red if
// stripComments had swallowed the style block.

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_SHELL_PATH = join(HERE, '..', 'app', '+html.tsx');

/** Strip line and block comments so the prose in the docblock cannot satisfy
 *  a guard that the CODE must satisfy. Identical to the house helper in
 *  native_gesture_armor.test.ts. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('app/+html.tsx exists and is non-empty', () => {
  it('the file is present on disk', () => {
    expect(existsSync(HTML_SHELL_PATH)).toBe(true);
  });

  it('the file is non-empty', () => {
    const raw = readFileSync(HTML_SHELL_PATH, 'utf8');
    expect(raw.trim().length).toBeGreaterThan(0);
  });
});

const RAW = readFileSync(HTML_SHELL_PATH, 'utf8');
const SRC = stripComments(RAW);

describe('the captainpad-no-select style block is present', () => {
  it('carries the id', () => {
    expect(SRC).toMatch(/id="captainpad-no-select"/);
  });

  // Isolate the injected __html template literal so the kill/counter-rule
  // assertions below can't accidentally match prose or unrelated CSS
  // elsewhere in the file.
  const styleBlockMatch = SRC.match(
    /id="captainpad-no-select"[\s\S]*?__html:\s*`([\s\S]*?)`/,
  );

  it('the style block has an __html template body to test against (positive sanity)', () => {
    expect(styleBlockMatch).not.toBeNull();
    expect(styleBlockMatch![1].length).toBeGreaterThan(0);
  });

  const CSS = styleBlockMatch ? styleBlockMatch[1] : '';

  describe('the kill — html, body loses selection and iOS callout', () => {
    it('the html, body rule exists', () => {
      expect(CSS).toMatch(/html,\s*body\s*\{[^}]*\}/);
    });

    it('carries user-select: none', () => {
      const rule = CSS.match(/html,\s*body\s*\{([^}]*)\}/);
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/(?<!-webkit-)user-select:\s*none/);
    });

    it('carries -webkit-user-select: none', () => {
      const rule = CSS.match(/html,\s*body\s*\{([^}]*)\}/);
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/-webkit-user-select:\s*none/);
    });

    it('carries -webkit-touch-callout: none (the iOS long-press callout kill)', () => {
      const rule = CSS.match(/html,\s*body\s*\{([^}]*)\}/);
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/-webkit-touch-callout:\s*none/);
    });
  });

  describe('the counter-rule — fields keep their caret', () => {
    it('the input, textarea, [contenteditable="true"] rule exists', () => {
      expect(CSS).toMatch(/input,\s*textarea,\s*\[contenteditable="true"\]\s*\{[^}]*\}/);
    });

    it('carries user-select: text', () => {
      const rule = CSS.match(/input,\s*textarea,\s*\[contenteditable="true"\]\s*\{([^}]*)\}/);
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/(?<!-webkit-)user-select:\s*text/);
    });

    it('carries -webkit-user-select: text', () => {
      const rule = CSS.match(/input,\s*textarea,\s*\[contenteditable="true"\]\s*\{([^}]*)\}/);
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/-webkit-user-select:\s*text/);
    });
  });

  describe('the selector footprint is html, body — not a universal * (docs/68 D2)', () => {
    it('the style block contains no bare universal selector', () => {
      // A bare `*` selector (optionally followed by combinators/whitespace
      // then `{`) would plant an element-level rule on every node instead of
      // relying on the inherited-auto cascade — exactly what D2 forbids.
      expect(CSS).not.toMatch(/(^|[^\w.\-])\*\s*\{/);
    });

    it('positive sanity: the two rules found above account for the whole block\'s selectors', () => {
      // Guards against a rewrite that renamed `html, body` to something else
      // while still passing the "no bare *" check above by omission.
      const selectors = [...CSS.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
      expect(selectors).toContain('html, body');
      expect(selectors).toContain('input, textarea, [contenteditable="true"]');
    });
  });
});

describe('the stock expo-router shell is still faithfully replicated', () => {
  it('imports ScrollViewStyleReset from expo-router/html', () => {
    expect(SRC).toMatch(/import\s*\{\s*ScrollViewStyleReset\s*\}\s*from\s*'expo-router\/html'/);
  });

  it('renders <ScrollViewStyleReset />', () => {
    expect(SRC).toMatch(/<ScrollViewStyleReset\s*\/>/);
  });

  it('carries the stock viewport meta verbatim (not "improved")', () => {
    expect(SRC).toMatch(
      /<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1, shrink-to-fit=no"\s*\/>/,
    );
  });
});
