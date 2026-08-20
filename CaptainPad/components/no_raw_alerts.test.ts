// no_raw_alerts — the regression guard behind the 2026-08-15 operator ruling.
//
// "do a deep analysis of alerts and make sure they are not like this regular
// HTML shit, and is handled properly as part of the app UI itself to be
// compatible with ipad too"
//
// Both banned surfaces are EASY to reach for and each fails silently in its own
// way, which is how 97 of them accumulated:
//
//   * `Alert.alert` — react-native-web's Alert export is an empty stub, so on
//     the web build (:6967, the podium client) it is a NO-OP. It looks correct
//     in review and in the iOS simulator, and shows nothing on the podium.
//   * `window.alert` / `confirm` / `prompt` — loud, but an unthemed browser
//     dialog stamped with the origin, ignoring all five themes and BLOCKING the
//     JS thread (engine WebSocket frames queue behind it).
//
// The whole app now goes through utils/op_dialog.ts. This test walks the real
// source tree, so a new call site fails CI on the day it is written rather than
// on the playa. It is a source scan rather than an eslint rule deliberately:
// `npm test` is the gate every agent already runs, and it needs no plugin.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directories that are not our source. */
const SKIP_DIRS = new Set([
  'node_modules', '.expo', '.git', 'dist', 'web-build', 'android', 'ios', 'scripts',
]);

/** The ONE module allowed to name these APIs — and it only does so in prose. */
const ALLOWED = new Set([
  join('utils', 'op_dialog.ts'),
  join('components', 'no_raw_alerts.test.ts'),
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip line and block comments so PROSE about the banned APIs — every one of
 *  which explains why it is banned — does not trip the scan. Crude but
 *  sufficient: it only has to be right about `//` and `/* *\/` runs. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Hit { file: string; line: number; text: string }

function scan(pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(APP_ROOT)) {
    const rel = relative(APP_ROOT, file);
    if (ALLOWED.has(rel)) continue;
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

const format = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

describe('no raw alert surfaces outside utils/op_dialog.ts', () => {
  it('nothing calls Alert.alert or Alert.prompt', () => {
    // Use opError / opWarn / opInfo for a toast, opConfirm / opDialog for a
    // question. Both work on the web build; Alert.alert does not.
    const hits = scan(/\bAlert\s*\.\s*(alert|prompt)\s*\(/);
    expect(format(hits), 'react-native Alert is a no-op on the web build').toBe('');
  });

  it('nothing imports Alert from react-native', () => {
    const hits = scan(/^\s*import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*['"]react-native['"]/);
    expect(format(hits), 'importing Alert is how the no-op creeps back in').toBe('');
  });

  it('nothing calls window.alert / window.confirm / window.prompt', () => {
    const hits = scan(/\bwindow\s*\.\s*(alert|confirm|prompt)\s*\(/);
    expect(format(hits), 'browser dialogs are unthemed and block the JS thread').toBe('');
  });

  it('nothing calls a bare global alert() / confirm() / prompt()', () => {
    // `alert('x')` with no receiver resolves to window.alert on web all the same.
    const hits = scan(/(^|[^.\w$])(alert|confirm|prompt)\s*\(\s*['"`]/);
    expect(format(hits), 'a bare alert() is still a browser dialog').toBe('');
  });

  it('the retired utils/op_alert.ts window.alert shim has not come back', () => {
    const hits = scan(/from\s*['"]@\/utils\/op_alert['"]/);
    expect(format(hits), 'op_alert was replaced by utils/op_dialog.ts').toBe('');
  });
});

describe('the scanner itself works', () => {
  // A guard test that cannot fail is worse than no guard, so prove the scan
  // actually reaches the tree and actually matches.
  it('walks a real, non-trivial source tree', () => {
    expect(sourceFiles(APP_ROOT).length).toBeGreaterThan(100);
  });

  it('matches the patterns it bans', () => {
    expect(/\bAlert\s*\.\s*(alert|prompt)\s*\(/.test("Alert.alert('x')")).toBe(true);
    expect(/\bwindow\s*\.\s*(alert|confirm|prompt)\s*\(/.test("window.confirm('x')")).toBe(true);
    expect(/(^|[^.\w$])(alert|confirm|prompt)\s*\(\s*['"`]/.test("  alert('x')")).toBe(true);
    // …and does NOT match the replacements, or an unrelated identifier.
    expect(/(^|[^.\w$])(alert|confirm|prompt)\s*\(\s*['"`]/.test("opConfirm('x')")).toBe(false);
    expect(/\bAlert\s*\.\s*(alert|prompt)\s*\(/.test("opError('x')")).toBe(false);
  });

  it('ignores banned names that appear only in comments', () => {
    expect(stripComments("// Alert.alert('x')\ncode()")).not.toContain('Alert.alert');
    expect(stripComments("/* window.alert('x') */\ncode()")).not.toContain('window.alert');
  });
});
