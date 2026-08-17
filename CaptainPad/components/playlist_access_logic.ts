// playlist_access_logic — PURE policy for what an operator may do to a playlist
// on the DECK and MIXER surfaces right now. No React / react-native imports, so
// vitest pins it in plain Node (same posture as playlist_row_sizing.ts and
// performance_mode_logic.ts).
//
// Why this is its own module: PlaylistPanel is the ONE playlist surface in the
// app — the deck (primary + split pane 2), every deck overlay and every mixer
// channel render it — so the question "what does the show lock actually stop?"
// has to have exactly one answer, in one place, or the two surfaces drift.
//
// ── The split (operator ruling 2026-08-16, report `_283`) ───────────────────
// "in the performance mode, allow playlist changing in the deck and mixer too."
//
// SELECTION is live control. Choosing which playlist a channel plays — and
// which entry inside it — is what performing IS; it changes what the rig looks
// like right now and nothing else. The engine treats it the same way: since
// `_283`, POST /deck/playlist and POST /mixer/channels/:id/playlist are out of
// the 409 table, alongside the entry routes that were always open. Neither
// writes a byte while a show is live, because auto-save is frozen
// (effectiveAutoSave() reads !performanceMode.active), and the pre-show
// snapshot records the binding — so RESTORE on exit still returns the rig to
// the playlist the operator went live with.
//
// EDITING is authoring. Create / duplicate / delete a playlist, add / remove /
// reorder / rename its entries, capture tuning into it: all of these rewrite a
// file on disk, all of them stay 409-gated during a show, and a non-owner edit
// session 403s them (docs/56 D6). Those affordances HIDE rather than render a
// button the engine would refuse.
//
// The two locks answer different questions, which is why they compose
// differently:
//   • `locked` — this channel is read-only for this operator. Wins over BOTH:
//     a channel you may not drive is not one you may re-point.
//   • `perfLocked` — a show is live. Blocks authoring only.
//   • `persistLocked` — a non-owner edit session; the engine will not persist
//     what this pad does (docs/56 D5a). Blocks authoring only, and deliberately
//     does NOT block selection: it asks "will this be written to disk", which is
//     the wrong question for an action defined as non-persistent. During a show
//     the engine pins editPrincipal to null, so folding it into selection would
//     have re-blocked exactly the case the operator asked for on every
//     auth-enabled show engine.

export interface PlaylistAccessInput {
  /** The per-channel read-only show flag (PlaylistPanel's `locked` prop). */
  locked: boolean;
  /** The engine-global performance lock (`usePerfLock()`). */
  perfLocked: boolean;
  /** A non-owner edit session — the engine will not persist (`useEditPersistLock()`). */
  persistLocked: boolean;
}

export interface PlaylistAccess {
  /**
   * May the operator change WHICH playlist plays (and tap entries within it)?
   * Open during a show — this is the performance itself.
   */
  selectable: boolean;
  /**
   * May the operator AUTHOR the library (create / duplicate / delete / add /
   * remove / reorder / rename / capture)? Every one of these writes a file.
   */
  editable: boolean;
}

export function playlistAccess(
  { locked, perfLocked, persistLocked }: PlaylistAccessInput,
): PlaylistAccess {
  return {
    selectable: !locked,
    editable: !locked && !perfLocked && !persistLocked,
  };
}

/**
 * Shown in the playlist library where the create / duplicate / delete rows
 * would be, whenever the operator may switch but not author. Says WHY they are
 * gone, so nobody hunts for a NEW button the engine would refuse anyway.
 */
export const LIBRARY_SWITCH_ONLY_HINT =
  'SWITCH ONLY — PLAYLIST EDITING RESUMES IN EDIT MODE.';
