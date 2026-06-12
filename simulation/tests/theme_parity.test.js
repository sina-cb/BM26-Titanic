import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the single-source-of-truth contract for theming: the sim's
// palettes (src/gui/theme.js) and the style.css boot defaults must match
// CaptainPad/constants/theme.ts VALUE-FOR-VALUE. The files live in
// different languages/runtimes, so this test extracts the literals from
// source text rather than importing modules (theme.js touches the DOM on
// import; theme.ts is TypeScript).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const CAPTAINPAD_THEME = path.join(REPO_ROOT, 'CaptainPad', 'constants', 'theme.ts');
const SIM_THEME = path.join(REPO_ROOT, 'simulation', 'src', 'gui', 'theme.js');
const SIM_CSS = path.join(REPO_ROOT, 'simulation', 'style.css');

const THEME_IDS = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];

/**
 * Extract `{ themeName: { token: 'value', ... }, ... }` palettes from a
 * source file by walking brace depth inside the named object literal.
 * Works for both the TS `export const Colors ... = {` and the JS
 * `const PALETTES = {` forms.
 */
function extractPalettes(source, anchorRegex) {
  const anchor = source.search(anchorRegex);
  assert.notEqual(anchor, -1, `Anchor ${anchorRegex} not found`);
  const start = source.indexOf('{', anchor);

  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = source.slice(start + 1, end);

  const palettes = {};
  // Theme blocks sit at depth 1: `light: { ... },`
  const themeRe = /(\w+):\s*\{/g;
  let m;
  while ((m = themeRe.exec(body)) !== null) {
    const name = m[1];
    if (!THEME_IDS.includes(name)) continue;
    let d = 1;
    let j = themeRe.lastIndex;
    for (; j < body.length && d > 0; j++) {
      if (body[j] === '{') d++;
      else if (body[j] === '}') d--;
    }
    const block = body.slice(themeRe.lastIndex, j - 1);
    const tokens = {};
    const tokenRe = /(\w+):\s*'([^']+)'/g;
    let t;
    while ((t = tokenRe.exec(block)) !== null) {
      tokens[t[1]] = t[2];
    }
    palettes[name] = tokens;
    themeRe.lastIndex = j;
  }
  return palettes;
}

function tokenToCssVar(token) {
  return `--${token.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

const tsSource = fs.readFileSync(CAPTAINPAD_THEME, 'utf8');
const jsSource = fs.readFileSync(SIM_THEME, 'utf8');
const cssSource = fs.readFileSync(SIM_CSS, 'utf8');

const tsPalettes = extractPalettes(tsSource, /export const Colors[^=]*=/);
const jsPalettes = extractPalettes(jsSource, /const PALETTES =/);

test('CaptainPad theme.ts parses into all five palettes', () => {
  assert.deepEqual(Object.keys(tsPalettes).sort(), [...THEME_IDS].sort());
  for (const id of THEME_IDS) {
    assert.ok(Object.keys(tsPalettes[id]).length >= 26,
      `${id}: expected the full token set, got ${Object.keys(tsPalettes[id]).length}`);
  }
});

for (const id of THEME_IDS) {
  test(`sim theme.js "${id}" palette matches CaptainPad value-for-value`, () => {
    assert.ok(jsPalettes[id], `theme.js is missing the "${id}" palette`);
    assert.deepEqual(jsPalettes[id], tsPalettes[id]);
  });
}

test('style.css :root boot defaults match the CaptainPad gruvbox palette (sim default theme)', () => {
  const rootStart = cssSource.indexOf(':root {');
  assert.notEqual(rootStart, -1, 'style.css must define a :root block');
  const rootEnd = cssSource.indexOf('}', rootStart);
  const rootBlock = cssSource.slice(rootStart, rootEnd);

  for (const [token, value] of Object.entries(tsPalettes.gruvbox)) {
    const cssVar = tokenToCssVar(token);
    const re = new RegExp(`${cssVar}:\\s*([^;]+);`);
    const m = re.exec(rootBlock);
    assert.ok(m, `style.css :root is missing ${cssVar}`);
    assert.equal(m[1].trim(), value, `style.css ${cssVar} drifted from CaptainPad gruvbox`);
  }
});
