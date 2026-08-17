// Playlist access policy — the deck + mixer answer to "what does the show lock
// actually stop?" (operator ruling 2026-08-16, report `_283`).
//
// PlaylistPanel is the ONE playlist surface in the app: the deck (primary and
// split pane 2), every deck overlay and every mixer channel render it. So this
// policy IS the deck path and the mixer path — pinning it here pins both.

import { describe, expect, it } from 'vitest';

import {
  LIBRARY_SWITCH_ONLY_HINT,
  playlistAccess,
} from './playlist_access_logic';

const UNLOCKED = { locked: false, perfLocked: false, persistLocked: false };

describe('playlistAccess', () => {
  it('lets the operator change playlist during a live show', () => {
    // THE operator ask: "in the performance mode, allow playlist changing in
    // the deck and mixer too." The dropdown that opens the library reads
    // `selectable`, so this is the whole feature in one assertion.
    expect(playlistAccess({ ...UNLOCKED, perfLocked: true }).selectable).toBe(true);
  });

  it('still refuses playlist AUTHORING during a live show', () => {
    // The targeted allowance stays targeted: every branch of `editable` writes
    // a file, and the engine 409s all of them while a show is live.
    expect(playlistAccess({ ...UNLOCKED, perfLocked: true }).editable).toBe(false);
  });

  it('keeps switching open for a non-owner edit session', () => {
    // `persistLocked` asks "will the engine write this to disk", which is the
    // wrong question for an action defined as non-persistent. It must not reach
    // selection — during a show the engine pins editPrincipal to null, so
    // folding it in would re-block the operator ask on every auth-enabled show
    // engine, which is the exact bug this separation prevents.
    const sailor = playlistAccess({ ...UNLOCKED, persistLocked: true });
    expect(sailor.selectable).toBe(true);
    expect(sailor.editable).toBe(false);

    const liveShowOnAuthEngine = playlistAccess({
      locked: false, perfLocked: true, persistLocked: true,
    });
    expect(liveShowOnAuthEngine.selectable).toBe(true);
    expect(liveShowOnAuthEngine.editable).toBe(false);
  });

  it('lets a read-only channel do neither', () => {
    // `locked` is the per-channel "not yours to drive" flag, and it outranks
    // both: a channel you may not perform with is not one you may re-point.
    for (const perfLocked of [false, true]) {
      for (const persistLocked of [false, true]) {
        expect(playlistAccess({ locked: true, perfLocked, persistLocked }))
          .toEqual({ selectable: false, editable: false });
      }
    }
  });

  it('gives an unlocked edit-mode operator everything', () => {
    expect(playlistAccess(UNLOCKED)).toEqual({ selectable: true, editable: true });
  });

  it('never offers authoring without selection', () => {
    // Structural invariant: editing a playlist you cannot even select would be
    // an unreachable affordance. Exhaustive over the 8-state input space.
    for (const locked of [false, true]) {
      for (const perfLocked of [false, true]) {
        for (const persistLocked of [false, true]) {
          const access = playlistAccess({ locked, perfLocked, persistLocked });
          if (access.editable) expect(access.selectable).toBe(true);
        }
      }
    }
  });

  it('explains the missing editing rows rather than hiding them silently', () => {
    expect(LIBRARY_SWITCH_ONLY_HINT).toMatch(/SWITCH ONLY/);
    expect(LIBRARY_SWITCH_ONLY_HINT).toMatch(/EDIT MODE/);
  });
});
