// playlist_panel_compact_rows_scope.test.ts — source-text guard proving
// docs/69 W3 R1's `compactRows` prop reaches exactly ONE `PlaylistPanel`
// mount (the mixer's) and never the deck's, so the deck stays pixel-
// identical per docs/69 §8 pin 4.
//
// WHY SOURCE TEXT. `mixer.tsx`, `DeckOverlayStack.tsx` and
// `split_playlist_panes.tsx` are RN components (`.tsx`), kept out of
// `vitest.config.ts`'s glob — there is no RN test renderer wired into this
// suite. Same idiom as `mixer_polish_source_guards.test.ts`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(...parts: string[]): string {
  return stripComments(readFileSync(join(HERE, ...parts), 'utf8'));
}

const MIXER = read('..', 'app', '(tabs)', 'mixer.tsx');
const DECK_OVERLAY = read('DeckOverlayStack.tsx');
const SPLIT_PANES = read('deck', 'split_playlist_panes.tsx');

describe("docs/69 W3 R1 — compactRows reaches the mixer's PlaylistPanel mount only", () => {
  it('the mixer channel-strip PlaylistPanel mount passes compactRows', () => {
    expect(MIXER).toMatch(/<PlaylistPanel[\s\S]{0,600}?compactRows/);
  });

  it('DeckOverlayStack never passes compactRows — its `compact` chrome flag is untouched by this wave', () => {
    expect(DECK_OVERLAY).toMatch(/<PlaylistPanel/); // sanity: the mount still exists
    expect(DECK_OVERLAY).not.toMatch(/compactRows/);
  });

  it('split_playlist_panes (both DECK A and DECK B) never passes compactRows', () => {
    const mounts = SPLIT_PANES.split('<PlaylistPanel').length - 1;
    expect(mounts).toBeGreaterThanOrEqual(2); // sanity: both panes still mount
    expect(SPLIT_PANES).not.toMatch(/compactRows/);
  });
});
