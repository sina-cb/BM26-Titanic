import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from './modal_orientation';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, '..');
const MODAL_PROP = 'supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}';

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'ios' || entry === 'android') continue;
      listSourceFiles(path, out);
      continue;
    }
    if (!entry.endsWith('.tsx')) continue;
    if (entry.includes('.test.')) continue;
    out.push(path);
  }
  return out;
}

/** Return each Modal opening tag, including multiline props. */
function modalOpeningTags(src: string): string[] {
  const withoutComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const tags: string[] = [];
  let idx = 0;
  while (idx < withoutComments.length) {
    const start = withoutComments.indexOf('<Modal', idx);
    if (start === -1) break;
    let cursor = start + 6;
    let depth = 0;
    let inString: '"' | "'" | '`' | null = null;
    let closed = false;
    while (cursor < withoutComments.length) {
      const ch = withoutComments[cursor];
      const prev = withoutComments[cursor - 1];
      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '>' && depth === 0) {
        tags.push(withoutComments.slice(start, cursor + 1));
        idx = cursor + 1;
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) break;
  }
  return tags;
}

describe('CaptainPad modal orientation contract', () => {
  it('declares landscape-only orientations compatible with the app lock', () => {
    expect(CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS).toEqual([
      'landscape',
      'landscape-left',
      'landscape-right',
    ]);
    expect(CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS).not.toContain('portrait');
    expect(CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS).not.toContain('portrait-upside-down');
  });

  it('wires supportedOrientations into every native Modal in operator surfaces', () => {
    const offenders: string[] = [];

    for (const path of listSourceFiles(APP_ROOT)) {
      const rel = path.slice(APP_ROOT.length + 1);
      const src = readFileSync(path, 'utf8');
      if (!src.includes('<Modal')) continue;

      if (!src.includes('CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS')) {
        offenders.push(`${rel}: missing modal_orientation import`);
        continue;
      }

      for (const tag of modalOpeningTags(src)) {
        if (!tag.includes(MODAL_PROP)) {
          offenders.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('documents the iPad Release SIGABRT signature this contract prevents', () => {
    // Release crash logs clustered on:
    //   UIViewController __supportedInterfaceOrientations
    //   -> _UIFullscreenPresentationController _prepareForMixedOrientationTransition...
    //   -> RCTModalHostViewComponentView ensurePresentedOnlyIfNeeded / didMoveToWindow
    // when a native Modal defaults to UIInterfaceOrientationMaskAll on iPad while
    // CaptainPad is landscape-locked. Missing supportedOrientations is the trigger.
    expect(CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS.every((o) => o.includes('landscape'))).toBe(true);
  });
});
