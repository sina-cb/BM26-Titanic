// playlist_panel_compact_rows_scope.test.ts — source-text guard for the
// `compactRows` prop's spread across the two `PlaylistPanel` mount sites:
//
//   docs/69 W3 R1 (2026-08-16)  — mixer channel-strip pattern list gets the
//     compact tier UNCONDITIONALLY (its own visible-pattern-count contract).
//   deck perf-split (2026-08-20) — deck `split_playlist_panes` gets it too
//     BUT ONLY when performance mode is active (usePerfLock is TRUE). In edit
//     mode the deck stays pixel-identical to the pre-2026-08-20 build.
//
// The `DeckOverlayStack` (single-list overlay, no split) does NOT participate:
// its rows keep the existing perf-tier tokens because it never runs into the
// "two panes, half a column each" real estate crunch that motivated the diet.
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

describe("compactRows scoping across PlaylistPanel mount sites", () => {
  it("the mixer channel-strip PlaylistPanel mount passes compactRows (docs/69 W3 R1)", () => {
    expect(MIXER).toMatch(/<PlaylistPanel[\s\S]{0,600}?compactRows/);
  });

  it('DeckOverlayStack never passes compactRows — the single-list overlay stays on the perf tier', () => {
    expect(DECK_OVERLAY).toMatch(/<PlaylistPanel/); // sanity: the mount still exists
    expect(DECK_OVERLAY).not.toMatch(/compactRows/);
  });

  it('split_playlist_panes passes compactRows on BOTH panes gated by usePerfLock() — perf-only diet, edit mode untouched', () => {
    const mounts = SPLIT_PANES.split('<PlaylistPanel').length - 1;
    expect(mounts).toBeGreaterThanOrEqual(2); // sanity: both panes still mount
    // Both DECK A and DECK B mounts pass the prop.
    const compactRowsMatches = SPLIT_PANES.match(/compactRows=\{[^}]+\}/g) ?? [];
    expect(compactRowsMatches.length).toBeGreaterThanOrEqual(2);
    // Every occurrence must be gated on the `perfLocked` symbol — the operator
    // asked for the diet ONLY in performance mode; a bare `compactRows` or one
    // gated on any other flag would break that contract silently.
    for (const m of compactRowsMatches) {
      expect(m).toMatch(/\bperfLocked\b/);
    }
    // usePerfLock() must actually be called somewhere in the module so the
    // symbol above resolves — a plain `perfLocked` variable that isn't bound
    // to the hook would pass the regex above without doing anything.
    expect(SPLIT_PANES).toMatch(/usePerfLock\s*\(\s*\)/);
  });
});
